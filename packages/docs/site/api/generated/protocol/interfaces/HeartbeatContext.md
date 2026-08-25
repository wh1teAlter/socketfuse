# 接口: HeartbeatContext

定义于: [core/src/shared/types.ts:391](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L391)

调用适配器心跳工厂时附加的上下文。

## 继承

- [`ProtocolContext`](ProtocolContext.md)

## 属性

### now

> `readonly` **now**: `number`

定义于: [core/src/shared/types.ts:363](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L363)

操作发生时的 Unix 时间戳，单位为毫秒。

#### 继承自

[`ProtocolContext`](ProtocolContext.md).[`now`](ProtocolContext.md#now)

***

### attempt

> `readonly` **attempt**: `number`

定义于: [core/src/shared/types.ts:393](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L393)

当前物理连接尝试计数。
