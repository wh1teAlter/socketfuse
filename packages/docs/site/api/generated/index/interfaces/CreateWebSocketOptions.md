# 接口: CreateWebSocketOptions\<Incoming, Outgoing, Auth\>

定义于: [core/src/shared/types.ts:493](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L493)

页面 client 及其共享物理连接的创建配置。

只能在浏览器页面 realm 调用 `createWebSocket` 时传入。会改变物理 socket 的字段
必须在同一 `id` 下完全一致；页面本地字段不参与共享 fingerprint。无效配置在创建
阶段同步抛出 `WwsError`，Worker 构造/握手失败按 `fallback` 决定拒绝或降级。

## 类型参数

### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

### Auth

`Auth` = `unknown`

## 属性

### id

> **id**: `string`

定义于: [core/src/shared/types.ts:495](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L495)

同源标签页共享连接的稳定业务 identity；不能为空，且不得包含凭据。

***

### protocols?

> `optional` **protocols?**: `string` \| readonly `string`[]

定义于: [core/src/shared/types.ts:497](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L497)

原生 WebSocket subprotocol token 或有序 token 列表；默认不传。

***

### worker?

> `optional` **worker?**: () => `SharedWorker`

定义于: [core/src/shared/types.ts:499](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L499)

页面本地 custom SharedWorker 工厂；默认使用内置 inline Worker。

#### 返回

`SharedWorker`

***

### protocol?

> `optional` **protocol?**: `ProtocolSelector`\<`Incoming`, `Outgoing`, `Auth`\>

定义于: [core/src/shared/types.ts:501](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L501)

消息协议；默认 raw 适配器。自定义 adapter 必须同时静态注册在 Worker。

***

### fallback?

> `optional` **fallback?**: `"direct"` \| `"error"`

定义于: [core/src/shared/types.ts:503](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L503)

Worker 构造或初始化失败时的页面本地策略；默认 `direct`。

***

### immediate?

> `optional` **immediate?**: `boolean`

定义于: [core/src/shared/types.ts:505](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L505)

创建后是否立即异步打开；页面本地，默认 `true`。

***

### autoClose?

> `optional` **autoClose?**: `boolean`

定义于: [core/src/shared/types.ts:507](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L507)

普通页面卸载时是否自动 detach；页面本地，默认 `true`。

***

### autoReconnect?

> `optional` **autoReconnect?**: `boolean` \| `Partial`\<[`ReconnectOptions`](ReconnectOptions.md)\>

定义于: [core/src/shared/types.ts:509](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L509)

共享重连策略；`true` 或省略使用指数退避默认值。

***

### connectionTimeout?

> `optional` **connectionTimeout?**: `number`

定义于: [core/src/shared/types.ts:511](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L511)

共享 socket open 与 adapter handshake 共用的超时，单位毫秒，默认 `10000`。

***

### binaryType?

> `optional` **binaryType?**: `"arraybuffer"` \| `"blob"`

定义于: [core/src/shared/types.ts:513](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L513)

共享二进制接收表示，默认 `arraybuffer`。

***

### heartbeat?

> `optional` **heartbeat?**: `boolean` \| `Partial`\<[`HeartbeatOptions`](HeartbeatOptions.md)\>

定义于: [core/src/shared/types.ts:515](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L515)

共享心跳策略；默认关闭，且必须由协议 adapter 声明支持。

***

### queue?

> `optional` **queue?**: `boolean` \| `Partial`\<[`QueueOptions`](QueueOptions.md)\>

定义于: [core/src/shared/types.ts:517](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L517)

共享有界出站队列策略；默认不允许离线或背压入队。

***

### backpressure?

> `optional` **backpressure?**: `Partial`\<[`BackpressureOptions`](BackpressureOptions.md)\>

定义于: [core/src/shared/types.ts:519](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L519)

共享原生 socket `bufferedAmount` 阈值。

***

### lease?

> `optional` **lease?**: `Partial`\<[`LeaseOptions`](LeaseOptions.md)\>

定义于: [core/src/shared/types.ts:521](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L521)

共享 client 活性租约。

***

### lifecycle?

> `optional` **lifecycle?**: [`LifecycleOptions`](LifecycleOptions.md)

定义于: [core/src/shared/types.ts:523](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L523)

页面本地 freeze/restore 处理；默认关闭。

***

### limits?

> `optional` **limits?**: `Partial`\<[`ConnectionLimits`](ConnectionLimits.md)\>

定义于: [core/src/shared/types.ts:525](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L525)

共享物理连接资源上限；不含 Worker 级控制平面上限。

***

### idleGraceMs?

> `optional` **idleGraceMs?**: `number`

定义于: [core/src/shared/types.ts:527](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L527)

最后一个 client 离开后关闭物理 socket 前的宽限期，单位毫秒，默认 `5000`。

***

### logger?

> `optional` **logger?**: [`WwsLogger`](../type-aliases/WwsLogger.md)

定义于: [core/src/shared/types.ts:529](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L529)

接收已脱敏运行诊断的页面本地 sink。

***

### onConnected?

> `optional` **onConnected?**: (`client`, `snapshot`) => `void`

定义于: [core/src/shared/types.ts:531](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L531)

逻辑 client open 后调用的页面本地回调。

#### 参数

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### snapshot

[`ConnectionSnapshot`](ConnectionSnapshot.md)

#### 返回

`void`

***

### onDisconnected?

> `optional` **onDisconnected?**: (`client`, `event`) => `void`

定义于: [core/src/shared/types.ts:533](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L533)

逻辑 client close 后调用的页面本地回调。

#### 参数

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### event

[`WwsCloseEvent`](WwsCloseEvent.md)

#### 返回

`void`

***

### onError?

> `optional` **onError?**: (`client`, `error`) => `void`

定义于: [core/src/shared/types.ts:535](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L535)

收到已脱敏 `WwsError` 时调用的页面本地回调。

#### 参数

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### error

[`WwsError`](../classes/WwsError.md)

#### 返回

`void`

***

### onMessage?

> `optional` **onMessage?**: (`client`, `event`) => `void`

定义于: [core/src/shared/types.ts:537](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L537)

初始业务消息回调；创建后仍可通过 `onMessage` 动态增加。

#### 参数

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### event

[`WwsMessageEvent`](WwsMessageEvent.md)\<`Incoming`\>

#### 返回

`void`
