# 接口: ConnectionDiagnostics

定义于: [core/src/shared/types.ts:279](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L279)

一个逻辑 client 与物理连接的已脱敏瞬时指标。

## 属性

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

定义于: [core/src/shared/types.ts:281](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L281)

页面当前选择的传输状态。

***

### logicalState

> `readonly` **logicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:283](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L283)

当前页面逻辑 client 状态。

***

### physicalState

> `readonly` **physicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:285](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L285)

物理 socket 状态。

***

### workerInstanceHash

> `readonly` **workerInstanceHash**: `string` \| `null`

定义于: [core/src/shared/types.ts:287](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L287)

SharedWorker 实例 id 的稳定 hash；direct 时为 `null`。

***

### controlProtocolMajor

> `readonly` **controlProtocolMajor**: `number`

定义于: [core/src/shared/types.ts:289](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L289)

已协商的控制协议 major 版本。

***

### idHash

> `readonly` **idHash**: `string`

定义于: [core/src/shared/types.ts:291](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L291)

连接 `id` 的稳定 hash，不暴露原值。

***

### configFingerprint

> `readonly` **configFingerprint**: `string`

定义于: [core/src/shared/types.ts:293](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L293)

共享配置的稳定 fingerprint。

***

### endpointOrigin

> `readonly` **endpointOrigin**: `string`

定义于: [core/src/shared/types.ts:295](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L295)

endpoint 的 origin；不含 path、query 或凭据。

***

### retryAttempt

> `readonly` **retryAttempt**: `number`

定义于: [core/src/shared/types.ts:297](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L297)

当前重连尝试次数。

***

### nextRetryDelay

> `readonly` **nextRetryDelay**: `number` \| `null`

定义于: [core/src/shared/types.ts:299](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L299)

下次重试延迟，单位为毫秒；没有计划时为 `null`。

***

### lastSafeCloseCode

> `readonly` **lastSafeCloseCode**: `number` \| `null`

定义于: [core/src/shared/types.ts:301](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L301)

最近一次可安全公开的 close code；未知时为 `null`。

***

### attachedClientCount

> `readonly` **attachedClientCount**: `number`

定义于: [core/src/shared/types.ts:303](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L303)

附着到该物理连接的逻辑 client 数量。

***

### queueMessages

> `readonly` **queueMessages**: `number`

定义于: [core/src/shared/types.ts:305](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L305)

当前出站队列消息数。

***

### queueBytes

> `readonly` **queueBytes**: `number`

定义于: [core/src/shared/types.ts:307](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L307)

当前出站队列编码后字节数。

***

### bufferedAmount

> `readonly` **bufferedAmount**: `number`

定义于: [core/src/shared/types.ts:309](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L309)

原生 socket 当前 bufferedAmount，单位为字节。

***

### outboundHighWater

> `readonly` **outboundHighWater**: `boolean`

定义于: [core/src/shared/types.ts:311](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L311)

是否已处于出站高水位。

***

### lastErrorCode

> `readonly` **lastErrorCode**: `string` \| `null`

定义于: [core/src/shared/types.ts:313](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L313)

最近可公开错误码；无错误时为 `null`。
