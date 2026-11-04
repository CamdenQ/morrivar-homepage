import test from 'node:test';
import assert from 'node:assert/strict';
import { oauthHeader, syncFeed as runSyncFeed, serveFeed, publicFeed } from '../worker/src/index.mjs';
import { validateFeed } from '../x-feed.js';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const syncFeed = (env, options) => runSyncFeed(env, { ...options, wait: async () => {} });
const DATE = '2026-11-03T10:00:00Z';
const keys = { X_API_KEY: 'test-key', X_API_SECRET: 'test-secret', X_ACCESS_TOKEN: 'test-token', X_ACCESS_TOKEN_SECRET: 'test-token-secret' };
const owner = { id: '12345', name: 'Morrivar', username: 'MorrivarGG', profile_image_url: 'https://pbs.twimg.com/profile_images/test.jpg', protected: false };
const post = (id, extra = {}) => ({ id, text: `Test post ${id}`, created_at: DATE, ...extra });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
function setup(initial = null) {
    let stored = initial ? structuredClone(initial) : null;
    const env = {
        ...keys, X_HANDLE: 'MorrivarGG', MONTHLY_READ_LIMIT: '1000',
        ALLOWED_ORIGINS: 'https://morrivar.com,http://localhost:8080',
        X_CACHE: {
            async get() { return structuredClone(stored); },
            async put(key, value) { assert.equal(key, 'x-feed:v1'); stored = JSON.parse(value); }
        }
    };
    return { env, state: () => structuredClone(stored) };
}
function queue(...responses) {
    const calls = [];
    const fetcher = async (url, options) => {
        calls.push({ url: new URL(url), options });
        assert.match(options.headers.Authorization, /^(OAuth |Bearer )/);
        assert.equal(options.redirect, 'manual');
        if (!responses.length) throw new Error('Unexpected API call');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
    };
    return { calls, fetcher };
}
async function seeded(posts = [post('2117784363026829615')]) {
    const setupResult = setup();
    const request = queue(json({ data: owner }), json({ data: posts, meta: { result_count: posts.length } }));
    assert.equal((await syncFeed(setupResult.env, { fetcher: request.fetcher, now: NOW })).status, 'ok');
    return setupResult;
}

test('OAuth signing matches the published OAuth 1.0 photos example', async () => {
    const header = await oauthHeader('http://photos.example.net/photos?file=vacation.jpg&size=original', {
        X_API_KEY: 'dpf43f3p2l4k3l03', X_API_SECRET: 'kd94hf93k423kf44',
        X_ACCESS_TOKEN: 'nnch734d00sl2jdk', X_ACCESS_TOKEN_SECRET: 'pfkkdhi9sl3r4s00'
    }, { nonce: 'kllo9940pd9333jh', timestamp: 1191242096 });
    assert.ok(header.includes('oauth_signature="tR3%2BTy81lMeYAr%2FFid0kMTYa%2FWM%3D"'));
});

test('missing credentials make zero API calls and do not manufacture a cache', async () => {
    const { env, state } = setup();
    delete env.X_API_SECRET;
    const request = queue();
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW })).status, 'needs_credentials');
    assert.equal(request.calls.length, 0);
    assert.equal(state(), null);
});

test('initial sync verifies the authenticated owner and fetches only five recent posts', async () => {
    const { env, state } = setup();
    const request = queue(json({ data: owner }), json({ data: [post('2117784363026829615')], meta: { result_count: 1 } }));
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW })).status, 'ok');
    assert.equal(request.calls[0].url.pathname, '/2/users/me');
    assert.equal(request.calls[1].url.searchParams.get('max_results'), '5');
    assert.equal(request.calls[1].url.searchParams.get('exclude'), 'retweets');
    assert.equal(request.calls[1].url.searchParams.has('since_id'), false);
    assert.equal(state().sinceId, '2117784363026829615');
    assert.equal(state().budget.resources, 2);
});

test('incremental sync uses exact 64-bit since_id; empty polling adds no read resources', async () => {
    const { env, state } = await seeded();
    const request = queue(json({ meta: { result_count: 0 } }));
    await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 });
    assert.equal(request.calls.length, 1);
    assert.equal(request.calls[0].url.searchParams.get('since_id'), '2117784363026829615');
    assert.equal(state().budget.resources, 2);
    assert.equal(state().posts.length, 1);
});

test('pagination resumes across runs without advancing the committed cursor prematurely', async () => {
    const { env, state } = await seeded([post('100')]);
    const first = queue(json({ data: [post('110'), post('109')], meta: { result_count: 2, next_token: 'next-page' } }));
    assert.equal((await syncFeed(env, { fetcher: first.fetcher, now: NOW + 1800000, maxPages: 1 })).status, 'more_pages');
    assert.equal(state().sinceId, '100');
    const next = queue(json({ data: [post('108')], meta: { result_count: 1 } }));
    await syncFeed(env, { fetcher: next.fetcher, now: NOW + 3600000 });
    assert.equal(next.calls[0].url.searchParams.get('since_id'), '100');
    assert.equal(next.calls[0].url.searchParams.get('pagination_token'), 'next-page');
    assert.equal(state().sinceId, '110');
    assert.deepEqual(state().posts.map(item => item.id), ['110', '109', '108', '100']);
    assert.equal(state().pending, undefined);
});

test('a later-page error retains the preceding page and resume token', async () => {
    const { env, state } = await seeded([post('100')]);
    const request = queue(json({ data: [post('110')], meta: { result_count: 1, next_token: 'resume' } }), json({ error: 'nope' }, 500));
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 })).status, 'upstream_500');
    assert.equal(state().sinceId, '100');
    assert.equal(state().pending.token, 'resume');
    assert.equal(state().posts[0].id, '110');
});

test('daily reconciliation removes deleted posts, updates edits and refreshes profile', async () => {
    const { env, state } = await seeded([post('102'), post('101')]);
    const request = queue(json({ data: { ...owner, name: 'Updated name' } }), json({ data: [post('101', { text: 'Edited text' })], meta: { result_count: 1 } }));
    await syncFeed(env, { fetcher: request.fetcher, now: NOW + 86400000 });
    assert.equal(request.calls[1].url.searchParams.has('since_id'), false);
    assert.equal(state().posts.length, 1);
    assert.equal(state().posts[0].text, 'Edited text');
    assert.equal(state().profile.name, 'Updated name');
    assert.equal(state().sinceId, '102');
});

test('successful empty reconciliation clears deleted posts while retaining cursor', async () => {
    const { env, state } = await seeded([post('102')]);
    const request = queue(json({ data: owner }), json({ meta: { result_count: 0 } }));
    await syncFeed(env, { fetcher: request.fetcher, now: NOW + 86400000 });
    assert.deepEqual(state().posts, []);
    assert.equal(state().sinceId, '102');
});

test('429 honors reset time and does not retry or destroy cached posts', async () => {
    const { env, state } = await seeded();
    const retryAt = NOW + 7200000;
    const request = queue(json({}, 429, { 'x-rate-limit-reset': String(retryAt / 1000) }));
    const result = await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 });
    assert.equal(result.status, 'rate_limited');
    assert.equal(result.retryAt, retryAt);
    const noCalls = queue();
    assert.equal((await syncFeed(env, { fetcher: noCalls.fetcher, now: NOW + 3600000 })).status, 'backoff');
    assert.equal(noCalls.calls.length, 0);
    assert.equal(state().posts.length, 1);
    assert.equal(state().budget.resources, 2);
});

test('failed authentication backs off; rotated credentials allow a fresh validation', async () => {
    const { env } = setup();
    const rejected = queue(json({ detail: 'private upstream details' }, 401));
    assert.equal((await syncFeed(env, { fetcher: rejected.fetcher, now: NOW })).status, 'authentication_or_access');
    assert.equal((await syncFeed(env, { fetcher: queue().fetcher, now: NOW + 1800000 })).status, 'backoff');
    env.X_ACCESS_TOKEN = 'rotated-test-token';
    const accepted = queue(json({ data: owner }), json({ meta: { result_count: 0 } }));
    assert.equal((await syncFeed(env, { fetcher: accepted.fetcher, now: NOW + 3600000 })).status, 'ok');
});

test('wrong user/private account is rejected before requesting posts', async () => {
    for (const data of [{ ...owner, username: 'SomeoneElse' }, { ...owner, protected: true }]) {
        const { env, state } = setup();
        const request = queue(json({ data }));
        assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW })).status, 'wrong_account_or_private');
        assert.equal(request.calls.length, 1);
        assert.deepEqual(state().posts, []);
    }
});

test('monthly guard stops calls before exceeding the configured resource allowance', async () => {
    const { env, state } = await seeded();
    env.MONTHLY_READ_LIMIT = '5';
    const request = queue();
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 })).status, 'read_limit');
    assert.equal(request.calls.length, 0);
    assert.equal(state().budget.resources, 2);
    const nextMonth = queue(json({ data: owner }), json({ meta: { result_count: 0 } }));
    env.MONTHLY_READ_LIMIT = '10';
    assert.equal((await syncFeed(env, { fetcher: nextMonth.fetcher, now: Date.parse('2026-12-01T12:00:00Z') })).status, 'ok');
    assert.equal(state().budget.month, '2026-12');
    assert.equal(state().budget.resources, 1);
});

test('partial errors and malformed post data preserve the good cache and cursor', async () => {
    for (const payload of [{ data: [post('120')], errors: [{ detail: 'not public' }] }, { data: [post('120', { created_at: 'invalid' })] }]) {
        const { env, state } = await seeded([post('100')]);
        await syncFeed(env, { fetcher: queue(json(payload)).fetcher, now: NOW + 1800000 });
        assert.equal(state().posts[0].id, '100');
        assert.equal(state().sinceId, '100');
        assert.equal(state().budget.resources, 3);
    }
});

test('ambiguous network failure reserves reads conservatively and preserves content', async () => {
    const { env, state } = await seeded();
    const result = await syncFeed(env, { fetcher: queue(new Error('secret diagnostic should not escape')).fetcher, now: NOW + 1800000 });
    assert.equal(result.status, 'network_or_parse_error');
    assert.equal(state().budget.resources, 7);
    assert.equal(state().posts.length, 1);
    assert.ok(!JSON.stringify(state()).includes('secret diagnostic'));
});

test('full note text, replies and safe links survive; sensitive/withheld content does not display', async () => {
    const { env, state } = setup();
    const request = queue(json({ data: owner }), json({ data: [
        post('105', { note_tweet: { text: 'Full long post https://t.co/abc', entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/', display_url: 'example.com' }] } }, referenced_tweets: [{ type: 'replied_to', id: '90' }], attachments: { media_keys: ['one'] }, edit_history_tweet_ids: ['104', '105'] }),
        post('104', { possibly_sensitive: true }), post('103', { withheld: { country_codes: ['US'] } }),
        post('102', { entities: { urls: [{ url: 'https://t.co/bad', expanded_url: 'javascript:alert(1)' }] } })
    ], meta: { result_count: 4 } }));
    await syncFeed(env, { fetcher: request.fetcher, now: NOW });
    assert.deepEqual(state().posts.map(item => item.id), ['105', '102']);
    assert.equal(state().posts[0].text, 'Full long post https://t.co/abc');
    assert.equal(state().posts[0].replyTo, '90');
    assert.equal(state().posts[0].hasMedia, true);
    assert.equal(state().posts[0].edited, true);
    assert.equal(state().posts[0].urls[0].href, 'https://t.co/abc');
    assert.equal(state().posts[1].urls[0].href, 'https://t.co/bad');
});

test('public endpoint returns only cached public data, never credentials or internal state', async () => {
    const { env, state } = await seeded();
    const response = await serveFeed(new Request('https://feed.example/api/x-feed', { headers: { Origin: 'https://morrivar.com' } }), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://morrivar.com');
    const body = await response.json();
    assert.deepEqual(body, publicFeed(state()));
    for (const key of [...Object.values(keys), 'credentialFingerprint', 'budget', 'retryAt']) assert.ok(!JSON.stringify(body).includes(key));
    // Same handler exposes no refresh route; public methods cannot contact X.
    assert.equal((await serveFeed(new Request('https://feed.example/api/refresh'), env)).status, 404);
    assert.equal((await serveFeed(new Request('https://feed.example/api/x-feed', { method: 'POST' }), env)).status, 405);
});

test('CORS rejects other origins; preflight and HEAD work without leaking content', async () => {
    const { env } = setup();
    assert.equal((await serveFeed(new Request('https://feed.example/api/x-feed', { headers: { Origin: 'https://attacker.example' } }), env)).status, 403);
    assert.equal((await serveFeed(new Request('https://feed.example/api/x-feed', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080' } }), env)).status, 204);
    assert.equal(await (await serveFeed(new Request('https://feed.example/api/x-feed', { method: 'HEAD' }), env)).text(), '');
    const empty = await (await serveFeed(new Request('https://feed.example/api/x-feed'), env)).json();
    assert.deepEqual(empty.posts, []);
});

test('frontend validation rejects another account and numeric/invalid IDs', () => {
    assert.throws(() => validateFeed({ profile: { name: 'Other', username: 'Other' }, posts: [] }));
    const data = { profile: { name: 'Morrivar', username: 'MorrivarGG' }, posts: [
        { id: '2117784363026829615', text: '<script>literal text</script>', createdAt: DATE },
        { id: 2117784363026829615, text: 'Bad numeric id', createdAt: DATE },
        { id: '123', text: 'Bad date', createdAt: 'bad' }
    ] };
    assert.equal(validateFeed(data).length, 1);
});

test('KV writes are spaced to respect the per-key write limit', async () => {
    const { env } = setup();
    const waits = [];
    await runSyncFeed(env, { fetcher: queue(json({ data: owner }), json({ meta: { result_count: 0 } })).fetcher, now: NOW, wait: async delay => waits.push(delay) });
    assert.equal(waits.length, 2);
    assert.ok(waits.every(delay => delay > 0 && delay <= 1100));
});

test('making the owner private withdraws previously cached posts', async () => {
    const { env, state } = await seeded();
    const request = queue(json({ data: { ...owner, protected: true } }));
    await syncFeed(env, { fetcher: request.fetcher, now: NOW + 86400000 });
    assert.deepEqual(state().posts, []);
    assert.equal(state().profile, null);
});

test('app-only Bearer authentication fetches the configured public profile without user tokens', async () => {
    const { env, state } = setup();
    for (const name of Object.keys(keys)) delete env[name];
    env.X_AUTH_MODE = 'app-only';
    env.X_BEARER_TOKEN = 'test-bearer-not-a-real-secret';
    const request = queue(json({ data: owner }), json({ data: [post('110')], meta: { result_count: 1 } }));
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW })).status, 'ok');
    assert.equal(request.calls[0].url.pathname, '/2/users/by/username/MorrivarGG');
    assert.ok(request.calls.every(call => call.options.headers.Authorization === `Bearer ${env.X_BEARER_TOKEN}`));
    assert.equal(state().posts[0].id, '110');
    assert.ok(!JSON.stringify(publicFeed(state())).includes(env.X_BEARER_TOKEN));
});

test('app-only mode cannot accidentally send a Client ID as an OAuth user token', async () => {
    const { env } = setup();
    env.X_AUTH_MODE = 'app-only';
    env.X_ACCESS_TOKEN = 'oauth2-client-id';
    const request = queue();
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW })).status, 'needs_credentials');
    assert.equal(request.calls.length, 0);
});

test('rotating only a secret permits retry after an authentication failure', async () => {
    const { env } = setup();
    await syncFeed(env, { fetcher: queue(json({}, 401)).fetcher, now: NOW });
    env.X_API_SECRET = 'corrected-secret';
    const request = queue(json({ data: owner }), json({ meta: { result_count: 0 } }));
    assert.equal((await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 })).status, 'ok');
});

test('API redirects are not followed with the credential header', async () => {
    const { env, state } = await seeded();
    const request = queue(json({}, 302, { Location: 'https://other.example/' }));
    const result = await syncFeed(env, { fetcher: request.fetcher, now: NOW + 1800000 });
    assert.equal(result.status, 'upstream_302');
    assert.equal(request.calls.length, 1);
    assert.equal(request.calls[0].options.redirect, 'manual');
    assert.equal(state().posts.length, 1);
});
