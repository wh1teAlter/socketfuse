# 接口: ConnectionSnapshot

定义于: [core/src/shared/types.ts:198](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L198)

`open()` 成功 resolve 时返回的不可变连接快照。

## 属性

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:200](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L200)

当前详细生命周期状态。

***

### status

> `readonly` **status**: [`WebSocketStatus`](../type-aliases/WebSocketStatus.md)

定义于: [core/src/shared/types.ts:202](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L202)

由详细状态推导的紧凑状态。

***

### readyState

> `readonly` **readyState**: [`ReadyState`](../type-aliases/ReadyState.md)

定义于: [core/src/shared/types.ts:204](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L204)

原生 WebSocket 兼容的数值状态。

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

定义于: [core/src/shared/types.ts:206](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L206)

当前 socket 所属传输通道。

***

### attempt

> `readonly` **attempt**: `number`

定义于: [core/src/shared/types.ts:208](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L208)

当前物理连接尝试的单调计数。

***

### connectedAt

> `readonly` **connectedAt**: `number`

定义于: [core/src/shared/types.ts:210](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L210)

最近一次成功打开的 Unix 时间戳，单位为毫秒；未打开时为 `0`。
