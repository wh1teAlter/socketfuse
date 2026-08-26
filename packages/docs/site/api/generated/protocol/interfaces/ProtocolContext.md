# 接口: ProtocolContext

定义于: [core/src/shared/types.ts:361](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L361)

传给协议适配器操作的基础时间上下文。

## 继承于

- [`AuthContext`](AuthContext.md)
- [`ClassifyContext`](ClassifyContext.md)
- [`DecodeContext`](DecodeContext.md)
- [`EncodeContext`](EncodeContext.md)
- [`HeartbeatContext`](HeartbeatContext.md)

## 属性

### now

> `readonly` **now**: `number`

定义于: [core/src/shared/types.ts:363](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L363)

操作发生时的 Unix 时间戳，单位为毫秒。
