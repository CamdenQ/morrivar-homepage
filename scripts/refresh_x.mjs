import fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { syncFeed, publicFeed } from '../worker/src/index.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// GitHub Actions persists only this cache state. The Bearer Token is supplied by
// an encrypted Actions secret and is never written into state or public JSON.
export async function refreshX({
    env = process.env,
    statePath = resolve(root, '.cache/x-feed-state.json'),
    feedPath = resolve(root, 'data/x-feed.json'),
    fetcher = fetch,
    now = Date.now()
} = {}) {
    await fs.mkdir(dirname(statePath), { recursive: true });
    await fs.mkdir(dirname(feedPath), { recursive: true });
    let state;
    try { state = JSON.parse(await fs.readFile(statePath, 'utf8')); }
    catch (error) {
        if (error.code !== 'ENOENT') throw error;
        // A fresh runner can start from the published public feed instead of
        // paying to download the same recent posts again.
        try {
            const seed = JSON.parse(await fs.readFile(feedPath, 'utf8'));
            if (seed.profile?.username?.toLowerCase() === 'morrivargg' && Array.isArray(seed.posts)) {
                const ids = seed.posts.map(post => post.id).filter(id => typeof id === 'string' && /^\d+$/.test(id));
                state = {
                    profile: seed.profile, posts: seed.posts,
                    sinceId: ids.reduce((a, b) => !a || BigInt(b) > BigInt(a) ? b : a, null),
                    updatedAt: seed.updatedAt, checkedAt: seed.checkedAt,
                    reconciledAt: seed.checkedAt || seed.updatedAt
                };
            }
        } catch (seedError) { if (seedError.code !== 'ENOENT') throw seedError; }
    }
    const cache = {
        get: async () => state ? structuredClone(state) : null,
        put: async (_key, value) => {
            await fs.writeFile(statePath, value);
            state = JSON.parse(value);
        }
    };
    const result = await syncFeed({
        X_BEARER_TOKEN: env.X_BEARER_TOKEN,
        X_AUTH_MODE: 'app-only',
        X_HANDLE: 'MorrivarGG',
        MONTHLY_READ_LIMIT: env.MONTHLY_READ_LIMIT || '1000',
        X_CACHE: cache
    }, { fetcher, now, wait: async () => {} });
    const feed = publicFeed(state);
    if (!feed.profile) throw new Error('No verified X profile is cached');
    await fs.writeFile(feedPath, JSON.stringify(feed, null, 2) + '\n');
    return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        let env = process.env;
        if (!env.X_BEARER_TOKEN) {
            try { env = { ...parseEnv(await fs.readFile(resolve(root, 'worker/.dev.vars'), 'utf8')), ...process.env }; }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (!env.X_BEARER_TOKEN) throw new Error('X_BEARER_TOKEN is not configured');
        const result = await refreshX({ env });
        console.log(JSON.stringify({ event: 'x_feed_refresh', ...result }));
        if (!['ok', 'more_pages', 'backoff'].includes(result.status)) console.warn(`::warning::X feed retained cached posts: ${result.status}`);
    } catch {
        console.error('X feed refresh failed. Existing public feed and cache were preserved. Check the X_BEARER_TOKEN secret and preceding sync status.');
        process.exitCode = 1;
    }
}
