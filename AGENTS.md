# AGENTS.md

## Project overview

TechFeed is a small technology-news aggregator. It fetches six configured RSS sources, stores normalized articles in SQLite, exposes a JSON API through Express, and serves a static vanilla JavaScript frontend from `public/`.

The root URL (`/`) is served by `express.static`. Unknown URLs must return JSON 404 responses rather than falling through to frontend HTML.

## Tech stack

- Runtime: Node.js (CI currently uses Node.js 22)
- Backend: Express 5, CommonJS modules
- Database: SQLite via `better-sqlite3`
- RSS ingestion: `rss-parser`
- Scheduling: `node-cron`
- Logging: `morgan`
- Frontend: static HTML, CSS and browser ES modules
- Outbound requests: native `fetch` with public-destination, timeout, content-type, byte-size, redirect and concurrency checks

There is no AI image-generation feature. Publisher-provided images can be proxied through the server; when an article has no usable image, the UI displays a CSS-only placeholder.

## Common commands

- `npm ci` — install the locked dependencies
- `npm start` — start the app
- `npm run dev` — start with Node watch mode
- `npm run check` — syntax-check server and browser JavaScript
- `npm test` — run tests with Node's built-in test runner

The app does not load `.env` automatically. Set runtime variables in the process environment or hosting settings.

## Project structure

- `server.js` — Express setup, static assets, API mounting, JSON 404 handlers, database and scheduler startup.
- `db/database.js` — SQLite schema, source synchronization, legacy generated-image cleanup, text cleanup and article upserts.
- `routes/articles.js` — article list, publisher-image proxy and text-preview endpoints.
- `routes/sources.js` — source list, article counts and last fetch timestamps.
- `routes/refresh.js` — UI-triggered manual refresh with same-origin action checks and a per-IP cooldown.
- `services/feedFetcher.js` — RSS parsing, article normalization, image URL extraction, bounded image enrichment and source-level in-flight deduplication.
- `services/refreshGuard.js` — validates that manual refresh requests carry the same-origin UI action marker.
- `services/safeFetch.js` — outbound URL validation, redirect checks, response limits, timeouts and concurrency control.
- `services/articlePreview.js` — article preview extraction, scoring, cleanup, caching and boilerplate filtering.
- `services/articleImageProxy.js` — fetches and validates publisher-provided image responses.
- `services/scheduler.js` — initial RSS fetch on startup and recurring 15-minute fetches.
- `services/textCleanup.js` — article title and text normalization.
- `public/index.html` — static page shell and preview modal.
- `public/js/api.js` — frontend API fetch helpers.
- `public/js/app.js` — frontend state, filtering, refresh-button handling, polling and pagination.
- `public/js/ui.js` — DOM rendering, source list, article cards and preview modal.
- `public/css/styles.css` — responsive UI styles and no-image placeholders.
- `test/` — unit tests.
- `scripts/check-syntax.js` — syntax-check file list used by CI.

## Refresh behavior

- The scheduler performs an initial fetch when the server starts, then runs every 15 minutes.
- The manual refresh button sends `POST /api/refresh` with a same-origin `Origin`, JSON content type and `X-TechFeed-Refresh-Action: ui-button` header.
- Other API endpoints must not trigger RSS fetches.
- Do not add arbitrary per-source refresh behavior to the public route. If manual refresh changes, preserve the cooldown and test the request guard.
- The UI marker is a browser-request guard, not authentication. HTTP clients can spoof headers; use real authentication if refresh must be protected against deliberate callers.

## API and routing behavior

- `GET /api/sources` — configured sources and article counts.
- `GET /api/articles` — paginated article list, optional `source`, `limit` and `offset`.
- `GET /api/articles/:id/image` — proxy publisher-provided article image.
- `GET /api/articles/:id/preview` — extract or return a cached text preview.
- `POST /api/refresh` — UI-button-only manual refresh request.
- Unknown API endpoints return HTTP 404 with `{ ok: false, error: 'API endpoint not found' }`.
- Unknown non-static paths return HTTP 404 with `{ ok: false, error: 'Endpoint not found' }`.
- Invalid article IDs return a non-2xx JSON response.

## Data and operational notes

- Runtime data lives under `data/`; `data/news.db` is created by the app and is ignored by Git.
- Startup migration removes legacy AI generated-image columns and the old `data/generated-images/` directory.
- Do not hand-edit runtime database files unless explicitly asked.
- SQLite is suitable for the current single-instance design. Rate limits, request queues and refresh coordination are process-local; multiple instances require shared coordination/storage.
- Public-destination checks in `safeFetch.js` reduce SSRF risks but do not fully prevent DNS rebinding. Public deployments also need network egress controls or DNS pinning.
- Avoid broad rewrites of `services/articlePreview.js`; it contains many heuristic filters and scoring rules.
- Preserve JSON 404 behavior and do not add a generic SPA fallback.
- Run `npm run check` and `npm test` before submitting changes.
