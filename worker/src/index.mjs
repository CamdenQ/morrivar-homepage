// Visitors read KV only. Only the scheduled handler can contact the paid X API.
const STATE_KEY = 'x-feed:v1';
const PAGE_SIZE = 5;
const DISPLAY_COUNT = 5;
const DAY = 86400000;
const SECRET_NAMES = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET'];
const encoder = new TextEncoder();
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const validId = value => typeof value === 'string' && /^\d{1,25}$/.test(value);
const newest = (a, b) => !a ? b : !b ? a : BigInt(a) > BigInt(b) ? a : b;

export async function oauthHeader(url, credentials, { nonce = crypto.randomUUID(), timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const oauth = {
    oauth_consumer_key: credentials.X_API_KEY,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(timestamp),
    oauth_token: credentials.X_ACCESS_TOKEN,
    oauth_version: '1.0'
  };
  const target = new URL(url);
  const params = [...target.searchParams, ...Object.entries(oauth)].map(([key, value]) => [encode(key), encode(value)]);
  params.sort(([ak, av], [bk, bv]) => ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0);
  const normalized = params.map(pair => pair.join('=')).join('&');
  const base = ['GET', `${target.origin}${target.pathname}`, normalized].map(encode).join('&');
  const key = await crypto.subtle.importKey('raw', encoder.encode(`${encode(credentials.X_API_SECRET)}&${encode(credentials.X_ACCESS_TOKEN_SECRET)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(base)));
  oauth.oauth_signature = btoa(String.fromCharCode(...signed));
  return `OAuth ${Object.entries(oauth).sort().map(([key, value]) => `${encode(key)}="${encode(value)}"`).join(', ')}`;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function normalizePost(post) {
  if (!validId(post.id) || typeof post.text !== 'string' || !Number.isFinite(Date.parse(post.created_at))) throw new Error('invalid_response');
  if (post.withheld || post.possibly_sensitive) return null;
  const note = post.note_tweet;
  const text = typeof note?.text === 'string' ? note.text : post.text;
  const entities = note?.entities || post.entities;
  return {
    id: post.id,
    text,
    createdAt: new Date(post.created_at).toISOString(),
    // Match the exact t.co token instead of UTF-16 offsets, which differ for emoji.
    urls: (entities?.urls || []).filter(item => typeof item.url === 'string').map(item => ({
      token: item.url,
      href: safeUrl(item.url),
      label: typeof item.display_url === 'string' ? item.display_url : item.url
    })).filter(item => item.href),
    replyTo: (post.referenced_tweets || []).find(item => item.type === 'replied_to' && validId(item.id))?.id || null,
    hasMedia: Boolean(post.attachments?.media_keys?.length),
    edited: Array.isArray(post.edit_history_tweet_ids) && post.edit_history_tweet_ids.length > 1
  };
}

export function publicFeed(state) {
  return {
    profile: state?.profile || null,
    posts: state?.posts || [],
    updatedAt: state?.updatedAt || null,
    checkedAt: state?.checkedAt || null
  };
}

class SyncError extends Error {
  constructor(code, retryAt) { super(code); this.retryAt = retryAt; }
}

// Dependency injection keeps every test offline and prevents accidental paid calls.
export async function syncFeed(env, { fetcher = fetch, now = Date.now(), maxPages = 4, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!env.X_CACHE) throw new Error('Missing X_CACHE binding');
  let state = await env.X_CACHE.get(STATE_KEY, 'json') || { posts: [], sinceId: null };
  let lastWrite = 0;
  const save = async () => {
    // KV permits one write per second to a single key, including final/error saves.
    const delay = 1100 - (Date.now() - lastWrite);
    if (delay > 0) await wait(delay);
    await env.X_CACHE.put(STATE_KEY, JSON.stringify(state));
    lastWrite = Date.now();
  };
  const month = new Date(now).toISOString().slice(0, 7);
  if (state.budget?.month !== month) state.budget = { month, resources: 0 };
  const appOnly = Boolean(env.X_BEARER_TOKEN) || env.X_AUTH_MODE === 'app-only';
  if (appOnly ? !env.X_BEARER_TOKEN : SECRET_NAMES.some(key => !env[key])) return { status: 'needs_credentials' };
  const handle = env.X_HANDLE || 'MorrivarGG';
  const configuredLimit = Number(env.MONTHLY_READ_LIMIT ?? 1000);
  const limit = Number.isInteger(configuredLimit) && configuredLimit >= PAGE_SIZE ? configuredLimit : 1000;
  const credentialMaterial = JSON.stringify([handle, appOnly ? 'app-only' : 'oauth1', ...(appOnly ? [env.X_BEARER_TOKEN] : SECRET_NAMES.map(key => env[key]))]);
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(credentialMaterial)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (state.retryAt > now && state.retryFingerprint === fingerprint) return { status: 'backoff', retryAt: state.retryAt };

  async function api(path, params, allowance) {
    if (state.budget.resources + allowance > limit) throw new SyncError('read_limit', Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() + 1, 1));
    // Reserve before a paid call. A crash/ambiguous network error counts conservatively.
    state.budget.resources += allowance;
    await save();
    const url = new URL(`https://api.x.com/2/${path}`);
    for (const [key, value] of Object.entries(params)) if (value) url.searchParams.set(key, value);
    const authorization = appOnly ? `Bearer ${env.X_BEARER_TOKEN}` : await oauthHeader(url.href, env);
    const response = await fetcher(url.href, { headers: { Authorization: authorization }, signal: AbortSignal.timeout(15000), redirect: 'manual' });
    if (!response.ok) {
      state.budget.resources -= allowance;
      const retrySeconds = Number(response.headers.get('retry-after'));
      const reset = Number(response.headers.get('x-rate-limit-reset')) * 1000;
      if (response.status === 429) throw new SyncError('rate_limited', Math.max(now + 30 * 60000, reset || 0, retrySeconds > 0 ? now + retrySeconds * 1000 : 0));
      throw new SyncError(response.status === 401 || response.status === 403 ? 'authentication_or_access' : `upstream_${response.status}`, now + (response.status === 401 || response.status === 403 ? DAY : 30 * 60000));
    }
    const body = await response.json();
    const count = Array.isArray(body.data) ? body.data.length : body.data ? 1 : 0;
    state.budget.resources += count - allowance;
    if (body.errors?.length) throw new Error('partial_response');
    return body;
  }

  try {
    if (!state.profile || state.credentialFingerprint !== fingerprint || !state.profileCheckedAt || now - Date.parse(state.profileCheckedAt) >= DAY) {
      const profilePath = appOnly ? `users/by/username/${encodeURIComponent(handle)}` : 'users/me';
      const { data } = await api(profilePath, { 'user.fields': 'profile_image_url,protected' }, 1);
      if (data?.protected && data.username?.toLowerCase() === handle.toLowerCase()) {
        state.posts = [];
        state.profile = null;
      }
      if (!validId(data?.id) || typeof data.name !== 'string' || data.username?.toLowerCase() !== handle.toLowerCase() || data.protected) throw new SyncError('wrong_account_or_private', now + DAY);
      if (state.profile && state.profile.id !== data.id) throw new SyncError('account_changed', now + DAY);
      const avatar = safeUrl(data.profile_image_url);
      state.profile = { id: data.id, name: data.name, username: data.username, avatar: avatar && new URL(avatar).hostname === 'pbs.twimg.com' ? avatar : null };
      state.credentialFingerprint = fingerprint;
      state.profileCheckedAt = new Date(now).toISOString();
    }

    // A daily latest-page refresh reconciles edits/deletions and updates the author.
    // Initial seed is deliberately limited to five posts; no paid history backfill.
    const reconcile = !state.pending && (!state.sinceId || !state.reconciledAt || now - Date.parse(state.reconciledAt) >= DAY);
    const fields = 'created_at,entities,referenced_tweets,attachments,note_tweet,possibly_sensitive,withheld,edit_history_tweet_ids';
    if (reconcile) {
      const body = await api(`users/${state.profile.id}/tweets`, { max_results: String(PAGE_SIZE), exclude: 'retweets', 'tweet.fields': fields }, PAGE_SIZE);
      if (!Array.isArray(body.data) && body.meta?.result_count !== 0) throw new Error('invalid_response');
      const raw = body.data || [];
      const posts = raw.map(normalizePost).filter(Boolean);
      state.posts = posts;
      // IDs are 64-bit integers: never coerce them to JavaScript Number.
      for (const post of raw) state.sinceId = newest(state.sinceId, post.id);
      state.reconciledAt = new Date(now).toISOString();
      state.updatedAt = state.reconciledAt;
    } else {
      for (let page = 0; page < maxPages; page++) {
        const pending = state.pending || { sinceId: state.sinceId, newestId: state.sinceId };
        const body = await api(`users/${state.profile.id}/tweets`, {
          max_results: String(PAGE_SIZE), exclude: 'retweets', 'tweet.fields': fields,
          since_id: pending.sinceId, pagination_token: pending.token
        }, PAGE_SIZE);
        if (!Array.isArray(body.data) && body.meta?.result_count !== 0) throw new Error('invalid_response');
        const raw = body.data || [];
        const posts = raw.map(normalizePost).filter(Boolean);
        for (const post of raw) pending.newestId = newest(pending.newestId, post.id);
        state.posts = [...new Map([...state.posts, ...posts].map(post => [post.id, post])).values()]
          .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, DISPLAY_COUNT);
        if (raw.length) state.updatedAt = new Date(now).toISOString();
        if (body.meta?.next_token) state.pending = { ...pending, token: body.meta.next_token };
        else { state.sinceId = pending.newestId; delete state.pending; break; }
      }
    }
    state.checkedAt = new Date(now).toISOString();
    state.lastError = null;
    state.retryAt = 0;
    await save();
    return { status: state.pending ? 'more_pages' : 'ok', posts: state.posts.length, resources: state.budget.resources };
  } catch (error) {
    // Never log upstream bodies, URLs with tokens, OAuth headers, or secret values.
    const code = error instanceof SyncError ? error.message : ['invalid_response', 'partial_response'].includes(error.message) ? error.message : 'network_or_parse_error';
    state.lastError = code;
    state.retryFingerprint = fingerprint;
    state.retryAt = error.retryAt || now + 30 * 60000;
    await save();
    const diagnostic = code === 'network_or_parse_error'
      ? /certificate|issuer|ssl|tls/i.test(error.message) ? 'tls'
        : /json|unexpected token/i.test(error.message) ? 'invalid_json'
          : /timeout|abort/i.test(error.message) ? 'timeout'
            : /network|connection|fetch failed/i.test(error.message) ? 'connection'
              : error.name === 'TypeError' ? 'type_error' : 'runtime_error'
      : undefined;
    return { status: code, retryAt: state.retryAt, ...(diagnostic ? { diagnostic } : {}) };
  }
}

export async function serveFeed(request, env) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(item => item.trim());
  if (origin && !allowed.includes(origin)) return new Response('{"error":"origin_not_allowed"}', { status: 403, headers });
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  if (new URL(request.url).pathname !== '/api/x-feed') return new Response('{"error":"not_found"}', { status: 404, headers });
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    return new Response(null, { status: 204, headers });
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, OPTIONS');
    return new Response('{"error":"method_not_allowed"}', { status: 405, headers });
  }
  let state;
  try { state = await env.X_CACHE.get(STATE_KEY, 'json'); }
  catch { return new Response('{"error":"cache_unavailable"}', { status: 503, headers }); }
  headers.set('Cache-Control', 'public, max-age=300');
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(publicFeed(state)), { headers });
}

export default {
  fetch: serveFeed,
  async scheduled(_event, env) {
    const result = await syncFeed(env);
    console.log(JSON.stringify({ event: 'x_feed_sync', ...result }));
  }
};
