# 接口: HeartbeatOptions

定义于: [core/src/shared/types.ts:62](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L62)

多标签页共享的应用层心跳策略；时间字段单位均为毫秒。

## 属性

### mode

> **mode**: `"pong"` \| `"activity"`

定义于: [core/src/shared/types.ts:64](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L64)

`pong` 要求应答，`activity` 则以任意入站活动续命。

***

### interval

> **interval**: `number`

定义于: [core/src/shared/types.ts:66](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L66)

两次心跳发送之间的间隔。

***

### pongTimeout

> **pongTimeout**: `number`

定义于: [core/src/shared/types.ts:68](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L68)

`pong` 模式等待应答的最长时间。

***

### message

> **message**: [`SocketData`](../type-aliases/SocketData.md)

定义于: [core/src/shared/types.ts:70](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L70)

发送给服务端的原生 WebSocket payload。

***

### responseMessage

> **responseMessage**: [`SocketData`](../type-aliases/SocketData.md)

定义于: [core/src/shared/types.ts:72](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L72)

在 `pong` 模式下被视为应答的原生 payload。
