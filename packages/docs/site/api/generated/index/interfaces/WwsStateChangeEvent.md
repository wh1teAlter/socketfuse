# 接口: WwsStateChangeEvent

定义于: [core/src/shared/types.ts:238](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L238)

页面逻辑状态改变时的详细通知。

## 继承

- `Event`

## 属性

### previous

> `readonly` **previous**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:240](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L240)

迁移前状态。

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

定义于: [core/src/shared/types.ts:242](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L242)

迁移后状态。

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

定义于: [core/src/shared/types.ts:244](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L244)

发生迁移时当前选定的传输通道。

***

### attempt

> `readonly` **attempt**: `number`

定义于: [core/src/shared/types.ts:246](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L246)

关联的物理连接尝试计数。

***

### reasonCode?

> `readonly` `optional` **reasonCode?**: `string`

定义于: [core/src/shared/types.ts:248](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L248)

可安全暴露的状态迁移原因码。
