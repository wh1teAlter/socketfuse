# 接口: ClassifyContext

定义于: [core/src/shared/types.ts:379](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L379)

调用适配器 `classify` 时附加的上下文。

## 继承

- [`ProtocolContext`](ProtocolContext.md)

## 属性

### now

> `readonly` **now**: `number`

定义于: [core/src/shared/types.ts:363](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L363)

操作发生时的 Unix 时间戳，单位为毫秒。

#### 继承自

[`ProtocolContext`](ProtocolContext.md).[`now`](ProtocolContext.md#now)

***

### receivedAt

> `readonly` **receivedAt**: `number`

定义于: [core/src/shared/types.ts:381](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L381)

收到原始 socket payload 的 Unix 时间戳，单位为毫秒。
