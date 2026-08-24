# Fallback and Worker

## Default inline Worker

By default WWS creates one build-generated inline SharedWorker and uses it to
own the socket. This is zero configuration and works when the application CSP
allows a `data:` Worker source.

`fallback: 'direct'` is the default. It uses a direct, page-local WebSocket
only when SharedWorker support, construction, loading or initialization fails.
It does not turn network, authentication, heartbeat or server-close failures
into a different transport.

Set `fallback: 'error'` for a hard single-connection policy:

```ts
const ws = createWebSocket(url, { fallback: 'error', id: 'critical-feed' })
```

## Custom Worker

Use a stable same-origin Worker URL when CSP disallows `data:`, when a custom
protocol adapter is needed, or when deployment policy requires a static asset.

```ts
const ws = createWebSocket(url, {
  id: 'events',
  worker: () => new SharedWorker('/assets/wws-worker.js'),
})
```

That Worker must call `exposeSharedWebSocketWorker()`. All SPAs intended to
share must use exactly the same Worker URL and origin. WWS does not create Blob
URLs or load Worker source from a CDN.

See [compatibility and security](../reference/compatibility-and-security) for
CSP, cookies, SameSite and `Origin: null` implications.
