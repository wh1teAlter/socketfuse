# Compatibility and security

## Browser and SSR baseline

WWS targets Chromium/Edge, Firefox and Safari 16+ where SharedWorker is
available. When it is absent, `fallback: 'direct'` keeps the client API while
restricting physical sharing to one JavaScript realm. `fallback: 'error'`
rejects that downgrade.

Importing `wws` is SSR-safe; creating a client requires a browser **page**
realm with both `window` and `document`. A Node runtime exposing global
`WebSocket` is not sufficient: `createWebSocket()` throws
`ENVIRONMENT_UNSUPPORTED` there and never opens a direct fallback socket.
Create clients in browser-only lifecycle code, never during server render.

## Deployment policy

An inline Worker uses a `data:` source. A CSP that disallows this needs a
static, same-origin custom Worker. Some servers treat Worker WebSocket traffic
as `Origin: null`; validate origin allowlists, cookie policy and authentication
against the Worker context before rollout.

Cookies sent to the WebSocket endpoint still follow browser credential and
SameSite rules. Do not use `id` as access control; include tenant/user identity
in server-side authentication and validate every message authorization.
