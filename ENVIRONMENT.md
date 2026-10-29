# Runtime configuration

Set these variables in the Node.js process environment or your hosting provider's environment settings. The application does not automatically load `.env` files.

- `PORT`: optional HTTP port; defaults to `3000`.
- `MAX_CONCURRENT_OUTBOUND_FETCHES`: optional maximum simultaneous bounded outbound HTTP requests; defaults to `8` and is capped at `32`.

The SQLite database is created at `data/news.db`. The app performs an initial feed fetch on startup and then refreshes the configured RSS feeds every 15 minutes. Users can also request a manual refresh through the UI button.

Outbound URL checks reduce SSRF risk, but DNS validation followed by a separate HTTP connection is not a complete defense against DNS rebinding. For a public deployment, also enforce egress restrictions or use a DNS-pinned HTTP client.

The manual refresh endpoint expects a same-origin JSON request with the UI action header. This helps prevent accidental and cross-origin browser requests; it is not authentication against a deliberate client that can spoof HTTP headers.
