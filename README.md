# Morrivar.com

Static HTML/CSS/JavaScript homepage for Morrivar's commentary and gaming, with a painted portrait, YouTube uploads, X posts, contact links, and saved light/dark preference.

## Project structure

- `index.html`, `styles.css`, `script.js` — homepage, theme and YouTube renderer.
- `x-feed.js`, `data/x-feed-config.json` — safe X post renderer and public endpoint configuration.
- `worker/` — shared sync implementation and optional Cloudflare backend; excluded from the Pages artifact.
- `tests/x-feed.test.mjs` — offline sync, OAuth, recovery, budget and endpoint tests.
- `scripts/refresh_x.mjs`, `scripts/refresh_youtube.py`, `.github/workflows/pages.yml` — scheduled feeds and GitHub Pages deployment.
- `assets/` — brand artwork, fonts and licensed icons.

## Run the website

```powershell
python -m http.server 8080 --bind 127.0.0.1
```

Open `http://localhost:8080`. The static site requires no build step. YouTube uses `data/youtube.json`, refreshed every six hours by the prepared Actions workflow. The channel RSS returned 404, so refresh falls back to the public uploads page with channel-identity verification.

## Custom X feed

Visitors read the public `data/x-feed.json` configured in `data/x-feed-config.json`; they cannot trigger a paid API request. GitHub Actions checks for updates twice an hour using `since_id`, then publishes the updated site. The first sync seeds only five posts, including replies and excluding reposts. At most five posts display. The private workflow cache preserves pagination, cursor, backoff, and read-counter state between runs. A daily latest-page refresh reconciles edits/deletions and refreshes the profile. Sensitive/withheld posts are omitted. This first version links to attached media on X and does not request media expansions or engagement counts.

The native profile timeline has been replaced by this feed. A profile link remains when the feed is unavailable or empty. The checked-in public JSON contains real posts, never sample posts or credentials.

### Credentials needed

The configured feed now uses **OAuth 2.0 app-only authentication** with one server-side secret:

- `X_BEARER_TOKEN` — the app's Bearer Token

The public profile is resolved by username; `/2/users/me` is not used in app-only mode. No callback URL, interactive sign-in, Client ID or Client Secret is required for this public feed. The initial Consumer Key/Secret were sufficient to obtain the app's Bearer Token using X's documented `POST /oauth2/token` exchange. The token is stored in the ignored local credential file and the repository's encrypted **Actions secret**, never in public JavaScript or JSON. The workflow exposes the secret only to the server-side refresh step.

Legacy OAuth 1.0a support remains available for apps that have it, when app-only mode is not selected. Its four settings are:

- `X_API_KEY` — consumer/API key
- `X_API_SECRET` — consumer/API key secret
- `X_ACCESS_TOKEN` — MorrivarGG user access token
- `X_ACCESS_TOKEN_SECRET` — its token secret

Copy `worker/.dev.vars.example` to `worker/.dev.vars` only when first configuring a new installation; preserve existing credentials. `.dev.vars`, `.env` files, Wrangler state and dependencies are ignored by Git. Never put secrets in HTML, `data/`, public configuration or chat. The returned profile must match the configured public account before posts are fetched. App-only mode has no authenticated user, so estimate costs using **standard rates**, without assuming the Owned Reads discount. Actual billing still needs verification in X's console.

The production deployment uses the existing GitHub Pages site and GitHub Actions. No Cloudflare login or DNS change is required. The optional Cloudflare Worker implementation is retained for future use.

### Local verification

```powershell
npm ci
npm test
npm run feed:refresh
```

`feed:refresh` reads the local Bearer Token from the environment or ignored `worker/.dev.vars`, updates the ignored `.cache/x-feed-state.json`, and writes only public feed fields into `data/x-feed.json`. The website uses the same public config locally and in production. It does not require the local Worker to render posts.

Optional Worker development remains available:

```powershell
npm run feed:check
npm run feed:dev
```

The optional Worker exposes a local-only scheduled test at `http://127.0.0.1:8787/__scheduled`; its production handler has no public refresh route. To use it as the website's backend, deploy Worker/KV, store `X_BEARER_TOKEN` as a Worker secret, and change the public config endpoint to its `/api/x-feed` URL.

### GitHub Pages deployment

1. Set repository Actions secret `X_BEARER_TOKEN` using GitHub settings or `gh secret set X_BEARER_TOKEN --repo CamdenQ/morrivar-homepage`. Supply the value through stdin, not a command-line argument.
2. Keep `data/x-feed-config.json` committed with `"endpoint": "data/x-feed.json"`. This public config is included in the published site.
3. Set the repository Pages build source to **GitHub Actions**, preserving its custom domain `morrivar.com`.
4. Push to `main`. The workflow tests the sync implementation, restores incremental state, refreshes X, saves state, refreshes YouTube, and publishes an explicit allowlist of public files.
5. Scheduled runs refresh X at minutes 17 and 47; YouTube additionally refreshes every six hours. Schedules and deployment/CDN propagation may delay visible updates.

Only HTML/CSS/JavaScript, `CNAME`, assets and public feed JSON enter the Pages artifact. Credential files, source-only worker files, dependency folders and private caches are excluded. Source code contains environment-variable names only. Actual API keys/tokens are not committed or published.

### Cost controls and operations

- `MONTHLY_READ_LIMIT` defaults to **1,000 returned resources per UTC month**, including profile reads. Capacity is checked before each call; ambiguous network failures reserve the requested maximum conservatively. Successful empty polls add zero resources.
- This application guard assumes one writer and persisted state. The workflow serializes runs and saves state in the Actions cache, but cache eviction can reset its counter. It is **not a guaranteed dollar billing cap**; also set a spending limit in X's console. Avoid duplicate deployments or parallel sync writers.
- Rate limits wait at least 30 minutes and honor a later reset time. Authentication/access errors wait 24 hours; rotated credentials trigger fresh validation. Good cached posts survive upstream failures; a verified switch to a private account withdraws them.
- Logs include status/count/retry metadata, never API bodies or secrets. Public JSON includes only the author, posts and update/check timestamps.
- The optional Worker spaces KV writes and caches responses for five minutes with configured-origin CORS. The active Pages setup serves same-origin static JSON through GitHub's CDN.
- Changes cannot be reconciled while X is unavailable. Check persistent errors and honor removal requests promptly. Daily reconciliation means edits/deletions can remain visible until the next successful recheck; an open browser page updates on reload.
- At five new posts/day: roughly 150 new posts + up to 150 daily rechecks + 30 profile reads is about 330 resources/month before deduplication. Standard post/profile rates imply about **$1.80/month** for the current app-only configuration. Do not assume the lower Owned Reads rate. Verify actual billing before scheduling; prices/access can change.

References: [X pricing](https://docs.x.com/x-api/getting-started/pricing), [posts and since_id](https://docs.x.com/x-api/users/get-posts), [Cloudflare configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## Customization

Contact copy lives in `index.html`; colors are CSS variables in `styles.css`. Existing brand geometry/artwork should be preserved. No unrelated visual polish is part of the custom feed work.

## License

All rights reserved unless explicit permission is granted. Third-party fonts/icons retain their included licenses.
