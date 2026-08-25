# Raw protocol

`raw` is the default protocol. Incoming and outgoing values are native
WebSocket data: strings, `Blob`, `ArrayBuffer` or typed array views.

```ts
const ws = createWebSocket('wss://api.example.com/raw', {
  id: 'raw-events',
  protocol: 'raw',
})
```

The socket becomes ready when its native `open` event fires. Raw mode supports
no protocol-level auth update or ping/pong template; it remains a useful base
when the server owns authentication and liveness outside WebSocket messages.
