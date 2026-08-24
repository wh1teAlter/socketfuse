# wws

`wws` shares one native WebSocket between same-origin browser tabs through a
SharedWorker. The public API is framework-agnostic and exposes a stable client
with dynamic `onMessage` handlers and `sendMessage` receipts.

```ts
import { createWebSocket } from 'wws'

const ws = createWebSocket('wss://api.example.com/realtime', {
  id: 'realtime:user-42',
  onMessage: (_client, event) => {
    console.log('message', event.data, event.replayed)
  },
})

await ws.open()
await ws.sendMessage({ type: 'presence', online: true })
```

The default is zero-config inline SharedWorker with `fallback: 'direct'` when
Worker construction or the initialization handshake fails. Use
`fallback: 'error'` when a second physical connection is unacceptable. A
connection id is not an authorization boundary; authentication still belongs
to the server and an application protocol adapter.

See the [documentation](packages/docs/index.md), [Playground](packages/docs/playground.md),
[technical specification](docs/specs/wws-v1-spec.md), and
[implementation tickets](docs/planning/02-wws-v1-tickets.md).
