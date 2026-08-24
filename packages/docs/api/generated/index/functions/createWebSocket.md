# Function: createWebSocket()

> **createWebSocket**\<`Incoming`, `Outgoing`, `Auth`\>(`url`, `options`): [`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

Defined in: [wws/src/index.ts:81](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/wws/src/index.ts#L81)

Create a page-local client backed by a same-origin SharedWorker connection.

The function returns synchronously. With `immediate: true` (the default),
opening starts in the background; call `open()` when the caller needs an
awaitable connection snapshot. Worker setup failures use the configured
direct/error fallback, while socket and protocol failures remain on the
selected transport.

## Type Parameters

### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

Decoded business payload delivered to `onMessage`.

### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

Application value accepted by `sendMessage`.

### Auth

`Auth` = `unknown`

Revisioned authentication value accepted by `updateAuth`.

## Parameters

### url

`string` \| `URL`

Initial absolute `ws:` or `wss:` endpoint.

### options

[`CreateWebSocketOptions`](../interfaces/CreateWebSocketOptions.md)\<`Incoming`, `Outgoing`, `Auth`\>

Shared connection and page-local behavior.

## Returns

[`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>
