# 接口: WebSocketClient\<Incoming, Outgoing, Auth\>

定义于: [core/src/shared/types.ts:550](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L550)

SharedWorker 所有或 direct WebSocket 的页面本地代理。

所有方法仅能在 `createWebSocket` 成功返回后调用。除 `diagnostics` 外，异步方法会以
`WwsError` reject；调用方应按稳定 `code` 判断失败，而不是匹配 message。

## 继承

- `EventTarget`

## 类型参数

### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

`onMessage` 派发的解码业务 payload。

### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

`sendMessage` 接受的应用值。

### Auth

`Auth` = `unknown`

`updateAuth` 接受的带 revision 认证值。

## 属性

### data

> `readonly` **data**: `Incoming` \| `null`

定义于: [core/src/shared/types.ts:552](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L552)

最近一次已派发业务 payload；首条消息前为 `null`。

***

### status

> `readonly` **status**: [`WebSocketStatus`](../type-aliases/WebSocketStatus.md)

定义于: [core/src/shared/types.ts:554](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L554)

紧凑的 `CONNECTING`、`OPEN` 或 `CLOSED` 状态。

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:556](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L556)

页面逻辑 client 的详细生命周期状态。

***

### readyState

> `readonly` **readyState**: [`ReadyState`](../type-aliases/ReadyState.md)

定义于: [core/src/shared/types.ts:558](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L558)

原生 WebSocket 兼容的数值 readyState。

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

定义于: [core/src/shared/types.ts:560](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L560)

当前选定的 transport。

***

### workerMode

> `readonly` **workerMode**: [`WorkerMode`](../type-aliases/WorkerMode.md)

定义于: [core/src/shared/types.ts:562](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L562)

inline、custom 或 direct/no Worker 部署方式。

***

### capabilities

> `readonly` **capabilities**: [`ProtocolCapabilities`](ProtocolCapabilities.md)

定义于: [core/src/shared/types.ts:564](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L564)

选定协议 adapter 声明的能力。

***

### open

> **open**: (`options?`) => `Promise`\<[`ConnectionSnapshot`](ConnectionSnapshot.md)\>

定义于: [core/src/shared/types.ts:572](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L572)

在未 dispose 阶段打开逻辑 client；并发调用共享同一次物理 open。

#### 参数

##### options?

可选 AbortSignal；仅取消当前等待者，不会关闭其他 client 的共享连接。

###### signal?

`AbortSignal`

#### 返回

`Promise`\<[`ConnectionSnapshot`](ConnectionSnapshot.md)\>

socket 与协议均 ready 时的连接快照。

#### 抛出

`ABORTED`、`CONNECTION_TIMEOUT`、协议或 transport 的安全错误。

***

### close

> **close**: () => `Promise`\<`void`\>

定义于: [core/src/shared/types.ts:579](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L579)

关闭当前页面的逻辑参与，但不 dispose 实例；close 后允许再次 `open`。

#### 返回

`Promise`\<`void`\>

detach 完成的 Promise。

#### 抛出

transport 控制失败时以 `WwsError` reject。

***

### sendMessage

> **sendMessage**: (`data`, `options?`) => `Promise`\<[`SendReceipt`](../type-aliases/SendReceipt.md)\>

定义于: [core/src/shared/types.ts:588](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L588)

在已创建且未 dispose 阶段提交一条业务消息，或在配置允许时将其有界入队。

#### 参数

##### data

`Outgoing`

由选定 adapter 接受的业务值。

##### options?

[`SendOptions`](SendOptions.md)

本次发送的队列覆盖和业务幂等键。

#### 返回

`Promise`\<[`SendReceipt`](../type-aliases/SendReceipt.md)\>

本地 `accepted` 或 `queued` 回执；不代表服务器已收到。

#### 抛出

`SEND_WHILE_DISCONNECTED`、`BACKPRESSURE`、队列/大小限制或编码错误。

***

### onMessage

> **onMessage**: (`handler`) => () => `void`

定义于: [core/src/shared/types.ts:595](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L595)

在 client 存活阶段添加一个页面本地业务消息 handler。

#### 参数

##### handler

(`event`) => `void`

接收业务帧与回放标记的回调；抛出不会阻塞其他 handler 或 Worker。

#### 返回

幂等移除函数；dispose 后仍可安全调用。

() => `void`

***

### updateAuth

> **updateAuth**: (`auth`, `options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

定义于: [core/src/shared/types.ts:604](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L604)

以更大的单调 revision 应用认证数据；仅在 adapter 声明 auth 能力时可用。

#### 参数

##### auth

`Auth`

不会写入诊断或跨 client 暴露的认证值。

##### options

共享 auth register 的正整数 revision。

###### revision

`number`

#### 返回

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

applied、stale 或 unchanged revision 回执。

#### 抛出

`CAPABILITY_UNSUPPORTED`、`CLIENT_DISPOSED` 或 transport 错误。

***

### clearAuth

> **clearAuth**: (`options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

定义于: [core/src/shared/types.ts:612](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L612)

以更大的 revision 清除认证与该页面拥有的待发业务数据。

#### 参数

##### options

共享 auth register 的正整数 revision。

###### revision

`number`

#### 返回

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

applied、stale 或 unchanged revision 回执。

#### 抛出

`CAPABILITY_UNSUPPORTED`、`CLIENT_DISPOSED` 或 transport 错误。

***

### updateUrl

> **updateUrl**: (`url`, `options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

定义于: [core/src/shared/types.ts:621](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L621)

以更大的 revision 更新共享 endpoint；必要时取消旧连接尝试并重连。

#### 参数

##### url

`string` \| `URL`

新的绝对 `ws:` 或 `wss:` URL。

##### options

共享 endpoint register 的正整数 revision。

###### revision

`number`

#### 返回

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

applied、stale 或 unchanged revision 回执。

#### 抛出

`INVALID_OPTIONS`、`CLIENT_DISPOSED` 或 transport 错误。

***

### reconnect

> **reconnect**: (`options?`) => `Promise`\<`void`\>

定义于: [core/src/shared/types.ts:629](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L629)

在 client 未 dispose 时显式开始新的共享连接尝试。

#### 参数

##### options?

可安全记录的调用原因；不会作为服务端 payload 发送。

###### reason?

`string`

#### 返回

`Promise`\<`void`\>

重连请求被接纳后的 Promise，不代表 socket 已 open。

#### 抛出

`CLIENT_DISPOSED` 或 transport 控制错误。

***

### diagnostics

> **diagnostics**: () => `Readonly`\<[`ConnectionDiagnostics`](ConnectionDiagnostics.md)\>

定义于: [core/src/shared/types.ts:635](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L635)

返回当前已脱敏运行指标；任意 client 状态均可调用。

#### 返回

`Readonly`\<[`ConnectionDiagnostics`](ConnectionDiagnostics.md)\>

不含 auth、URL query、业务 payload 或内部堆栈的快照。

***

### dispose

> **dispose**: () => `Promise`\<`void`\>

定义于: [core/src/shared/types.ts:642](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L642)

永久释放该页面 client、handler 与 transport 参与；dispose 后不能再次 open。

#### 返回

`Promise`\<`void`\>

本地清理与 detach 完成的 Promise。

#### 抛出

transport 清理异常会以安全 `WwsError` reject，但本地终态仍保持 dispose。
