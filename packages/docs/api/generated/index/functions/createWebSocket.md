# Function: createWebSocket()

## Call Signature

> **createWebSocket**(`url`, `options`): [`WebSocketClient`](../interfaces/WebSocketClient.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\>

Defined in: [wws/src/index.ts:107](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/wws/src/index.ts#L107)

Create a page-local client backed by a same-origin SharedWorker connection.

The function returns synchronously. With `immediate: true` (the default),
opening starts in the background; call `open()` when the caller needs an
awaitable connection snapshot. Worker setup failures use the configured
direct/error fallback, while socket and protocol failures remain on the
selected transport.

### Parameters

#### url

`string` \| `URL`

Initial absolute `ws:` or `wss:` endpoint.

#### options

[`CreateWebSocketOptions`](../interfaces/CreateWebSocketOptions.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\> & `object`

Shared connection and page-local behavior.

### Returns

[`WebSocketClient`](../interfaces/WebSocketClient.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\>

## Call Signature

> **createWebSocket**\<`Incoming`, `Outgoing`, `Auth`\>(`url`, `options`): [`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

Defined in: [wws/src/index.ts:111](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/wws/src/index.ts#L111)

Create a page-local client backed by a same-origin SharedWorker connection.

The function returns synchronously. With `immediate: true` (the default),
opening starts in the background; call `open()` when the caller needs an
awaitable connection snapshot. Worker setup failures use the configured
direct/error fallback, while socket and protocol failures remain on the
selected transport.

### Type Parameters

#### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

Decoded business payload delivered to `onMessage`.

#### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

Application value accepted by `sendMessage`.

#### Auth

`Auth` = `unknown`

Revisioned authentication value accepted by `updateAuth`.

### Parameters

#### url

`string` \| `URL`

Initial absolute `ws:` or `wss:` endpoint.

#### options

[`CreateWebSocketOptions`](../interfaces/CreateWebSocketOptions.md)\<`Incoming`, `Outgoing`, `Auth`\>

Shared connection and page-local behavior.

### Returns

[`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>
