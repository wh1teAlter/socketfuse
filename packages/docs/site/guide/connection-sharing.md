# Connection sharing

## `id` is the sharing identity

Tabs share a physical socket only when they run on the same origin, connect to
the same SharedWorker script, and use the same `id` with the same shared
configuration. Treat `id` as an application namespace, for example
`notifications:${tenantId}:${userId}`. It is not an authorization boundary.

## Shared configuration conflicts

The first client establishes the shared configuration. Another client using the
same `id` must agree on endpoint, WebSocket subprotocols, protocol adapter,
reconnect/heartbeat/queue/backpressure/lease/limits and idle grace settings.
A mismatch is rejected with `CONNECTION_CONFIG_CONFLICT`; use a different `id`
when the connection should be independent.

The following are page-local and do not cause a conflict: `onMessage`, other
callbacks, `logger`, lifecycle restore/replay options, `immediate`, `fallback`,
`autoClose`, and Worker construction mechanism.

## Auth and URL changes use revisions

Updating a shared endpoint or auth value is explicitly ordered by a monotonic
revision. A newer value applies and triggers a reconnect when needed; stale
updates are safely ignored.

```ts
await ws.updateAuth({ token: freshToken }, { revision: 4 })
await ws.updateUrl('wss://api.example.com/events-v2', { revision: 5 })
await ws.clearAuth({ revision: 6 })
```

Every caller should coordinate revision ownership in its application. Auth
payloads are never exposed through diagnostics.
