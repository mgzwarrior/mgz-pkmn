# ADR 0007: FastAPI backend + Server-Sent Events for streaming lookup results

- **Status:** Accepted
- **Date:** 2026-05-09
- **Tags:** api, web, streaming

## Context

The CLI and the web UI need to share the same parser, lookup, and
output pipeline — duplicating any of that would guarantee drift. The
web UI also needs to feel responsive for large input lists: a 100-line
input takes ~30 seconds end-to-end on a cold cache, and waiting silently
for that is a worse experience than seeing rows appear as they resolve.

The streaming options for "server pushes events to a browser":

- **WebSocket.** Bidirectional, but bidirectionality isn't needed —
  results only flow server → client. Adds complexity (handshake,
  reconnect handling, message framing).
- **Server-Sent Events.** One-way streaming over a regular HTTP/1.1
  connection. Browser support is universal in modern browsers. The
  server side is just `Content-Type: text/event-stream` and yielding
  `data: {…}\n\n` frames.
- **Long-polling.** Works everywhere, including ancient browsers. More
  client-side state to manage; chunked event delivery is awkward.

## Decision

- **Backend:** [FastAPI](https://fastapi.tiangolo.com) for HTTP routing
  and `pydantic` request/response validation. The same Python package
  imports the CLI's parser, lookup, and writers — no logic is
  duplicated. The API extras are opt-in (`uv sync --extra api`) so the
  CLI install stays lightweight.
- **Streaming:** Server-Sent Events for the bulk-lookup endpoint
  (`POST /api/v1/bulk`). The handler iterates the input lines,
  resolves each, and yields one `data: <Row JSON>\n\n` frame per
  resolved row. The browser's `EventSource` (or a `fetch` reader, in
  this codebase) consumes them as they arrive.
- Single-line `POST /api/v1/lookup`, `POST /api/v1/parse`, `POST
  /api/v1/export`, `GET /api/v1/sets`, `POST /api/v1/overrides` round
  out the surface — none need streaming.

## Consequences

- The CLI and the web UI literally call the same Python functions.
  Adding a flag to the CLI typically just needs a new field on the
  matching API request model + a UI control to populate it.
- SSE is HTTP/1.1-friendly — runs through every reverse proxy without
  special config. No WebSocket upgrade dance.
- Chrome / Firefox / Safari all support SSE without polyfill.
- The dev experience is two terminals (`make dev-api` + `make
  dev-web`); the Vite dev server proxies `/api/*` so the browser
  doesn't see CORS during development.
- Frontend abort handling is a `AbortController` on the `fetch` —
  closing the tab or hitting a "Stop" button cancels the stream
  cleanly.
- If we ever want bidirectional control (e.g. cancel a single row
  mid-stream), SSE will fall short. Mitigated by: nothing currently
  needs that, and we can add a parallel WebSocket endpoint without
  touching the existing flow.

## Alternatives considered

- **Flask + Blueprints.** Mature ecosystem, but Pydantic-driven
  request validation with auto-generated OpenAPI docs is genuinely
  nicer in FastAPI. Swagger UI ships at `/docs` for free.
- **Django REST.** Far heavier than the API surface needs.
- **WebSockets.** Strictly more capable but the bidirectionality is
  overkill for "server streams events to browser." Easier to reason
  about with SSE.
- **Polling for results.** Works but feels worse — either the polling
  interval is short (wasteful) or long (laggy). SSE just shows rows
  as they land.
