# AGENTS.md

## Project Overview

TechFeed is a small tech news aggregator. It fetches RSS feeds from configured sources, stores normalized articles in SQLite, serves JSON APIs from Express, and renders a static vanilla JavaScript frontend from `public/`.

The app has no build step. `server.js` starts the backend, serves the frontend, initializes the database, and starts the scheduled RSS refresh loop.

## Tech Stack

- Runtime: Node.js
- Backend: Express 5, CommonJS modules
- Database: SQLite via `better-sqlite3`
- RSS ingestion: `rss-parser`
- Scheduling: `node-cron`
- Logging and middleware: `morgan`, `cors`, `express.json()`
- Frontend: static HTML, CSS, and browser ES modules
- Generated article images: OpenAI Images API via native `fetch`

## Common Commands

- `npm start` - run `server.js`
- `npm run dev` - run `server.js` with Node watch mode

There is currently no test, lint, or build script defined in `package.json`.

## Project Structure

- `server.js` - Express app setup, middleware, static file serving, API route mounting, SPA fallback, database initialization, and scheduler startup.
- `db/database.js` - SQLite setup, source configuration, schema creation, lightweight schema evolution with `ensureColumn`, source syncing, generated-image cleanup, and article upserts.
- `routes/articles.js` - article listing endpoint, article preview endpoint, and generated-image endpoint.
- `routes/sources.js` - source listing endpoint with article counts and last fetch times.
- `routes/refresh.js` - manual RSS refresh endpoint for all sources or one source slug.
- `services/feedFetcher.js` - RSS fetch and normalization, image URL extraction, feed item cleanup, and article-page image fallback.
- `services/scheduler.js` - startup fetch and recurring 15-minute feed refresh.
- `services/articlePreview.js` - article preview extraction, scoring, cleanup, caching, and boilerplate filtering.
- `services/imageGenerator.js` - generated article cover creation, OpenAI image request, cache checks, in-flight request deduplication, and DB status updates.
- `public/index.html` - static app shell and modal markup.
- `public/js/api.js` - thin frontend fetch wrapper for backend endpoints.
- `public/js/app.js` - frontend state, loading flow, routing via query params, refresh handling, polling, and view orchestration.
- `public/js/ui.js` - DOM rendering helpers, cards, source list, metrics, preview modal, generated SVG placeholders, and image upgrade requests.
- `public/css/styles.css` - complete responsive visual system for the app.
- `data/` - runtime-created SQLite database and generated images. This is not source code.

## Runtime Data and Environment

`db/database.js` creates `data/news.db` and `data/generated-images/` at startup if they do not exist.

Generated article images require:

- `OPENAI_API_KEY`
- Optional: `OPENAI_IMAGE_MODEL`, default `gpt-image-2`
- Optional: `OPENAI_IMAGE_SIZE`, default `1536x1024`
- Optional: `OPENAI_IMAGE_QUALITY`, default `low`

The default server port is `3000`, overridden with `PORT`.

## Backend Conventions

- Use CommonJS on the server: `require(...)` and `module.exports`.
- Keep route files thin. Routes should validate request input, call services or database helpers, and return JSON.
- Keep reusable application behavior in `services/`.
- Access SQLite through `getDb()` from `db/database.js`.
- Prefer prepared statements and parameter binding for SQL.
- Use `better-sqlite3` transactions for grouped writes.
- Keep RSS source definitions in the `SOURCES` array in `db/database.js`.
- Keep schema changes idempotent. Existing migrations use `ensureColumn(...)` during startup rather than a separate migration framework.
- Store dates as ISO strings with `new Date().toISOString()`.
- Return predictable JSON shapes, commonly `{ ok: true, ...result }` and `{ ok: false, error: err.message }`.
- Log background job failures with a clear prefix such as `[feedFetcher]`, `[scheduler]`, or `[startup]`.

## Frontend Conventions

- Use browser ES modules in `public/js`.
- Keep network calls in `public/js/api.js`.
- Keep state and orchestration in `public/js/app.js`.
- Keep DOM rendering and formatting helpers in `public/js/ui.js`.
- Build DOM nodes with `document.createElement` for dynamic article/source UI. Small fixed snippets are sometimes assigned with `innerHTML`.
- Use `textContent` for user/feed-provided text.
- Use query parameters for source filtering: `?source=<slug>`.
- Keep interactive elements keyboard accessible where practical, such as source filters using `role="button"`, `tabindex`, and Enter/Space handlers.
- Frontend copy has a polished editorial tone; keep new labels concise and consistent with the existing TechFeed voice.

## CSS and UI Conventions

- Styling is centralized in `public/css/styles.css`.
- The visual language is dark, editorial, and dashboard-like.
- Design tokens live in `:root` as CSS custom properties.
- Layout uses CSS Grid and Flexbox with responsive media queries at `1120px`, `960px`, and `720px`.
- Use existing classes and variables before adding new visual patterns.
- Source-specific accents are passed through `--source-color`.
- Preserve responsive behavior for the sticky header/sidebar desktop layout and single-column mobile layout.

## Data Flow

1. `server.js` starts Express, calls `initializeDb()`, then starts the scheduler.
2. `initializeDb()` creates runtime directories, tables, indexes, missing columns, and synced source rows.
3. `startScheduler()` runs an immediate fetch, then refreshes every 15 minutes.
4. `fetchAll()` loads sources from SQLite, fetches feeds in parallel, normalizes items, and upserts articles.
5. The frontend loads sources and articles from `/api/sources` and `/api/articles`.
6. Article cards open a preview modal that calls `/api/articles/:id/preview`.
7. Missing or broken article images can trigger `/api/articles/:id/generate-image`.

## Notes for Future Agents

- Do not assume `data/news.db` exists before the app starts.
- Do not hand-edit runtime database files unless explicitly asked.
- Avoid adding a bundler or frontend framework unless the task clearly requires it.
- Avoid broad rewrites of `articlePreview.js`; it contains many heuristic filters and scoring rules.
- If adding endpoints, mount them under `/api/...` so the SPA fallback does not intercept them.
- If adding generated files or caches, keep them under `data/` or another clearly runtime-only directory.
