# 函数: createWebSocket()

`wws` 浏览器端公开入口。

这里只转出稳定 facade 与类型，不让消费者依赖私有 `@wws/core` 包或 Worker 内部实现。

## 调用签名

> **createWebSocket**(`url`, `options`): [`WebSocketClient`](../interfaces/WebSocketClient.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\>

定义于: [wws/src/api/create-websocket.ts:80](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/wws/src/api/create-websocket.ts#L80)

创建由同源 SharedWorker 连接驱动的页面本地客户端。

函数同步返回。`immediate: true`（默认值）时会在后台开始打开；需要可等待的
连接快照时调用 `open()`。Worker 建立失败遵循配置的 direct/error 降级策略，
socket 和协议错误则始终留在已选 transport 中处理。

### 参数

#### url

`string` \| `URL`

初始的绝对 `ws:` 或 `wss:` endpoint。

#### options

[`CreateWebSocketOptions`](../interfaces/CreateWebSocketOptions.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\> & `object`

共享连接与页面本地行为。

### 返回

[`WebSocketClient`](../interfaces/WebSocketClient.md)\<[`JsonValue`](../type-aliases/JsonValue.md), [`JsonValue`](../type-aliases/JsonValue.md), `unknown`\>

稳定的页面本地客户端；`immediate` 为 true 时首次打开会在后台进行。

### 抛出

在非浏览器页面 realm、选项无效、`fallback` 为 `error` 且 Worker 不可用，
或 direct WebSocket 降级不可用时，同步抛出 `WwsError`。

## 调用签名

> **createWebSocket**\<`Incoming`, `Outgoing`, `Auth`\>(`url`, `options`): [`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

定义于: [wws/src/api/create-websocket.ts:84](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/wws/src/api/create-websocket.ts#L84)

创建由同源 SharedWorker 连接驱动的页面本地客户端。

函数同步返回。`immediate: true`（默认值）时会在后台开始打开；需要可等待的
连接快照时调用 `open()`。Worker 建立失败遵循配置的 direct/error 降级策略，
socket 和协议错误则始终留在已选 transport 中处理。

### 类型参数

#### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

由 `onMessage` 接收的已解码业务 payload。

#### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

`sendMessage` 可接受的应用值。

#### Auth

`Auth` = `unknown`

`updateAuth` 可接受的带 revision 认证值。

### 参数

#### url

`string` \| `URL`

初始的绝对 `ws:` 或 `wss:` endpoint。

#### options

[`CreateWebSocketOptions`](../interfaces/CreateWebSocketOptions.md)\<`Incoming`, `Outgoing`, `Auth`\>

共享连接与页面本地行为。

### 返回

[`WebSocketClient`](../interfaces/WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

稳定的页面本地客户端；`immediate` 为 true 时首次打开会在后台进行。

### 抛出

在非浏览器页面 realm、选项无效、`fallback` 为 `error` 且 Worker 不可用，
或 direct WebSocket 降级不可用时，同步抛出 `WwsError`。
