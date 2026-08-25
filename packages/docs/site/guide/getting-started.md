# Getting started

Install `wws`, then create one client per page that needs to participate in a
shared connection.

```ts
import { createWebSocket } from 'wws'

const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:tenant-a',
})

const removeMessageHandler = ws.onMessage((event) => {
  console.log(event.data, event.replayed)
})

await ws.open()
await ws.sendMessage(JSON.stringify({ type: 'subscribe', topic: 'orders' }))

removeMessageHandler()
await ws.dispose()
```

## Zero configuration

`protocol: 'raw'`, an inline SharedWorker, reconnects, bounded resource limits
and `fallback: 'direct'` are the defaults. The only required option is `id`.

Use `protocols` when the WebSocket server requires subprotocol negotiation:

```ts
const ws = createWebSocket('wss://api.example.com/events', {
  id: 'events:tenant-a',
  protocols: ['json.v2'],
})
```

## Opening and closing

`createWebSocket()` only creates a page client. With the default `immediate`
option it starts opening right away; set `immediate: false` to make the first
`open()` explicit. `close()` closes this page's logical participation;
`dispose()` also removes listeners and releases the client permanently.

Use [`WebSocketClient`](../api/generated/index/interfaces/WebSocketClient.md)
for the complete client contract.
