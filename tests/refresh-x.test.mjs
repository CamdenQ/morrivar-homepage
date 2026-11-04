import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { refreshX } from '../scripts/refresh_x.mjs';

const now = Date.parse('2026-11-04T12:00:00Z');
const profile = { id: '12345', name: 'Morrivar', username: 'MorrivarGG' };
const post = { id: '2117784363026829615', text: 'Public test post', createdAt: '2026-11-04T10:00:00Z', urls: [] };

test('Actions refresh preserves incremental state without writing credentials to files', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'morrivar-feed-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, 'cache/state.json');
    const feedPath = path.join(directory, 'public/x-feed.json');
    const token = 'test-token-never-persist-this';
    const seed = { profile, posts: [post], updatedAt: post.createdAt, checkedAt: new Date(now - 1800000).toISOString() };
    await fs.mkdir(path.dirname(feedPath), { recursive: true });
    await fs.writeFile(feedPath, JSON.stringify(seed));
    const calls = [];
    const fetcher = async (input, options) => {
        const url = new URL(input);
        calls.push(url);
        assert.equal(options.headers.Authorization, `Bearer ${token}`);
        return new Response(JSON.stringify(url.pathname.endsWith('/tweets') ? { meta: { result_count: 0 } } : { data: profile }), { headers: { 'Content-Type': 'application/json' } });
    };
    const env = { X_BEARER_TOKEN: token };
    assert.equal((await refreshX({ env, statePath, feedPath, fetcher, now })).status, 'ok');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].searchParams.get('since_id'), post.id);
    calls.length = 0;
    assert.equal((await refreshX({ env, statePath, feedPath, fetcher, now: now + 1800000 })).status, 'ok');
    assert.equal(calls.length, 1);
    const stateText = await fs.readFile(statePath, 'utf8');
    const feedText = await fs.readFile(feedPath, 'utf8');
    assert.ok(!stateText.includes(token));
    assert.ok(!feedText.includes(token));
    assert.ok(!feedText.includes('credentialFingerprint'));
    assert.deepEqual(JSON.parse(feedText).posts, [post]);
    assert.equal(JSON.parse(stateText).budget.resources, 1);
});

test('Actions refresh retains the latest cached posts on upstream failure', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'morrivar-feed-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const statePath = path.join(directory, 'state.json');
    const feedPath = path.join(directory, 'x-feed.json');
    await fs.writeFile(feedPath, JSON.stringify({ profile, posts: [post], checkedAt: new Date(now).toISOString() }));
    const result = await refreshX({ env: { X_BEARER_TOKEN: 'test-token' }, statePath, feedPath, now, fetcher: async () => new Response('{}', { status: 429 }) });
    assert.equal(result.status, 'rate_limited');
    assert.deepEqual(JSON.parse(await fs.readFile(feedPath, 'utf8')).posts, [post]);
    assert.ok(JSON.parse(await fs.readFile(statePath, 'utf8')).retryAt > now);
});
