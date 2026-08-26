# 接口: DecodeContext

定义于: [core/src/shared/types.ts:373](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L373)

调用适配器 `decode` 时附加的上下文。

## 继承

- [`ProtocolContext`](ProtocolContext.md)

## 属性

### now

> `readonly` **now**: `number`

定义于: [core/src/shared/types.ts:363](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L363)

操作发生时的 Unix 时间戳，单位为毫秒。

#### 继承自

[`ProtocolContext`](ProtocolContext.md).[`now`](ProtocolContext.md#now)

***

### receivedAt

> `readonly` **receivedAt**: `number`

定义于: [core/src/shared/types.ts:375](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L375)

收到原始 socket payload 的 Unix 时间戳，单位为毫秒。
