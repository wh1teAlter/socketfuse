# Events and client

`createWebSocket()` returns a `WebSocketClient`, not a promise or a global
singleton. Its properties are snapshots of the local page proxy; use
`diagnostics()` for shared connection observations.

## Dynamic messages

`onMessage(handler)` can be called after creation or after opening. It returns
an unsubscribe function and supports multiple independent handlers. A throwing
handler is isolated and reported through the error path.

```ts
const off = ws.onMessage(event => render(event.data))
off()
```

The instance also dispatches `message`, `statechange`, `open`, `close`, `error`,
`overflow` and `diagnostic` events for `addEventListener` users.

## Intentional v1 boundary

There is no `subscribe()` method because dynamic `onMessage()` is the single
message-listener abstraction. There is no `request()` helper, correlation map,
server Ack or delivery guarantee. Model request/reply and durable delivery in
the application protocol when needed.
