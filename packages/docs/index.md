---
layout: home
title: wws
hero:
  name: wws
  text: Shared WebSocket connections across browser tabs
  tagline: A SharedWorker-first transport with a direct WebSocket fallback.
---

# Quick start

```ts
import { createWebSocket } from 'wws'

const ws = createWebSocket('wss://api.example.com/realtime', {
  id: 'chat:tenant-a:user-42',
  onMessage: (_client, event) => {
    renderMessage(event.data)
  },
})

await ws.open()
await ws.sendMessage({ type: 'join', room: 'general' })
```

`id` is the explicit sharing identity. Tabs that use the same `id`, initial URL
and shared configuration attach to one physical WebSocket. `lifecycle`, local
listeners and other page-local options do not create a configuration conflict.
Later endpoint and auth changes are ordered across the shared connection by
monotonic revisions instead of becoming part of its static fingerprint.

## Message handling

`onMessage` can be registered and removed at any time. Every registration is
independent, and a throwing handler does not stop the other handlers. The
latest business message is available as `ws.data`; protocol frames such as
ready, ping and pong never replace it.

`sendMessage()` resolves to either:

```json
[
  { "status": "accepted", "messageId": "<id>", "bufferedAmount": 0 },
  { "status": "queued", "messageId": "<id>", "position": 1 }
]
```

These receipts only describe local acceptance. WWS v1 does not implement a
server Ack, request correlation or `request()` helper. Queueing is opt-in:
`queue: true` enables FIFO memory queueing for disconnected and backpressured
states, capped at 100 messages and 1 MiB by default.

## Protocols and auth

Raw WebSocket data is the default. Declarative JSON is passed directly:

```ts
const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events',
  protocol: {
    type: 'json',
    ready: { status: 'ready' },
    auth: { template: { type: 'auth', token: '$auth' } },
    heartbeat: {
      ping: { type: 'ping' },
      pong: { type: 'pong' },
      serverPing: { type: 'server-ping' },
      serverPong: { type: 'server-pong' },
    },
  },
})

await ws.updateAuth({ token: 'short-lived-token' }, { revision: 1 })
```

Matcher keys are dot/bracket paths such as `meta.code` and `items[0].kind`.
For complex protocols, register a `ProtocolAdapter` in a custom Worker entry;
adapter functions never cross a `MessagePort`.

## Fallback and diagnostics

Only Worker API support, construction, loading and initialization handshake
errors can use `fallback: 'direct'`. Network failures, authentication errors,
heartbeat timeout and server close codes stay on the selected transport.

```ts
const ws = createWebSocket(url, {
  id: 'critical-feed',
  fallback: 'error',
  immediate: false,
})

ws.addEventListener('diagnostic', () => console.log(ws.diagnostics()))
```

Diagnostics expose transport, state, origin, stable id/config hashes, retry,
queue and overflow counters. Auth values, URL query strings, payloads and
internal stacks are excluded.

## Lifecycle restore

Restore is disabled by default. Enable it per page when a hidden/frozen page
should stop receiving live messages:

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  lifecycle: { restore: { replay: true, maxMessages: 256, maxBytes: 4 * 1024 * 1024 } },
})
```

Replay is bounded and uses the normal `onMessage` path with
`event.replayed === true`. Overflow drops the oldest buffered message and
emits `overflow`; Worker restart, lease expiry and page termination are not
reliable message recovery boundaries.

## Worker deployment

The default inline Worker uses a stable build-generated `data:` source. CSP,
Cookie/SameSite or `Origin: null` requirements are reasons to deploy a custom,
same-origin Worker URL instead:

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  worker: () => new SharedWorker('/wws-worker.js'),
  protocol: 'raw',
})
```

The custom Worker must call `exposeSharedWebSocketWorker()` and statically
register any custom adapter. Keep the Worker URL identical across SPAs that
need to share connections. WWS does not create Blob URLs or load Worker code
from a CDN.

## Compatibility

Chromium/Edge, Firefox and Safari 16+ are the target SharedWorker baseline.
When SharedWorker is unavailable, direct fallback keeps the API and error
semantics while limiting sharing to the current JavaScript realm. Node/SSR
imports are safe, but creating a connection requires browser WebSocket APIs.
