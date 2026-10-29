# TechFeed

TechFeed is a lightweight technology-news aggregator. It collects RSS articles from six configured publishers, stores them in SQLite, and presents a filterable web interface with text previews and publisher-provided images.

## Features

- Periodic RSS ingestion every 15 minutes, plus an initial fetch at startup
- Six configured sources: The Verge, TechCrunch, Engadget, PC Gamer, dev.ua and AIN
- SQLite persistence and URL-based article deduplication
- Source filters, paginated article cards and a lead-story layout
- Text-only article previews extracted from publisher pages and cached in SQLite
- Publisher images fetched through a size-limited server-side proxy
- Outbound request URL checks, redirect validation, timeouts, content-type checks, response-size limits and bounded concurrency
- JSON 404 responses for unknown API and page routes

The app does not generate AI images. If a publisher does not provide an image, TechFeed shows a CSS-only placeholder.

## Requirements

- Node.js 22 or a compatible supported Node.js release
- npm

## Run locally

```bash
npm ci
npm start
```

Open [http://localhost:3000](http://localhost:3000). To use another port, set `PORT` before starting the app.

For development with Node's watch mode:

```bash
npm run dev
```

The application creates `data/news.db` automatically. Runtime files are kept under `data/` and are excluded from Git. The app does not automatically load a `.env` file.

## Refresh behavior

The scheduler fetches feeds once during startup and then every 15 minutes. You can also press **Refresh** in the UI to run a manual refresh.

The manual route (`POST /api/refresh`) requires a same-origin JSON request with the `X-TechFeed-Refresh-Action: ui-button` header and has a per-IP cooldown. Other API endpoints do not trigger a feed refresh. The origin/action checks are intended to block accidental and cross-origin browser calls, not to authenticate against a deliberate HTTP client that can spoof headers.

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/sources` | List configured sources and article counts |
| `GET` | `/api/articles` | Return paginated articles; accepts optional `source`, `limit` and `offset` query parameters |
| `GET` | `/api/articles/:id/image` | Fetch a publisher-provided article image through the server |
| `GET` | `/api/articles/:id/preview` | Return an extracted/cached text preview; `?force=true` requests a fresh extraction |
| `POST` | `/api/refresh` | Trigger manual refresh from the UI button only |

Unknown API paths return HTTP 404 and JSON:

```json
{ "ok": false, "error": "API endpoint not found" }
```

Unknown non-static paths also return HTTP 404 and JSON:

```json
{ "ok": false, "error": "Endpoint not found" }
```

There is no catch-all frontend/SPA route. The root URL and real files under `public/` are served as static assets.

## Configuration

- `PORT`: HTTP port; defaults to `3000`.
- `MAX_CONCURRENT_OUTBOUND_FETCHES`: maximum simultaneous bounded outbound requests; defaults to `8` and is capped at `32`.

See [ENVIRONMENT.md](ENVIRONMENT.md) for runtime notes and the known DNS-rebinding limitation.

## Checks and tests

```bash
npm run check
npm test
```

GitHub Actions runs these checks on pushes to `main` and `fix/**`, and on pull requests targeting `main`.

## Data and deployment notes

- The default SQLite file is `data/news.db`.
- SQLite and the local filesystem are designed for a single app instance.
- In-memory cooldowns and outbound request limits are per process. Multiple instances need shared coordination and persistent shared storage.
- Outbound URL validation reduces SSRF exposure but is not a complete defense against DNS rebinding. A public deployment should also use network egress restrictions or a DNS-pinned HTTP client.
