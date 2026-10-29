# Runtime configuration

Set these variables in the Node.js process environment or your hosting provider's environment settings. The application does not automatically load `.env` files.

- `OPENAI_API_KEY`: required for AI cover generation.
- `IMAGE_GENERATION_TOKEN`: a private random secret of at least 32 characters. Required to call the image-generation API endpoint.
- `IMAGE_GENERATION_LIMIT_PER_HOUR`: optional per-process generation-request quota; defaults to 10.
- `MAX_CONCURRENT_IMAGE_GENERATIONS`: optional per-process concurrency limit; defaults to 2.
- `MAX_CONCURRENT_OUTBOUND_FETCHES`: optional maximum simultaneous bounded HTTP requests; defaults to 8.

AI image generation is deliberately not triggered when the normal page renders. To generate a cover manually, call `POST /api/articles/:id/generate-image` with the `x-image-generation-token` header. Keep this token server-side or in a trusted admin environment; never embed it in frontend JavaScript.

The request quota, outbound concurrency limit, and generation concurrency limit are in-memory and apply to a single Node.js process. For multiple application instances, use shared rate-limit storage and a shared generation queue.

Outbound URL checks reduce SSRF risk, but DNS validation followed by a separate HTTP connection is not a complete defense against DNS rebinding. For a public deployment, also enforce egress restrictions or use a DNS-pinned HTTP client.
