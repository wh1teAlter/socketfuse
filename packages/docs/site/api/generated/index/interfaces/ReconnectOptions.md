# 接口: ReconnectOptions

定义于: [core/src/shared/types.ts:46](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L46)

多标签页共享的重连策略；所有时间字段单位均为毫秒。

## 属性

### retries

> **retries**: `number`

定义于: [core/src/shared/types.ts:48](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L48)

最大重试次数；`Infinity` 表示不设上限，默认值为 `Infinity`。

***

### initialDelay

> **initialDelay**: `number`

定义于: [core/src/shared/types.ts:50](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L50)

指数退避的起始延迟，默认值为 `1000`。

***

### maxDelay

> **maxDelay**: `number`

定义于: [core/src/shared/types.ts:52](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L52)

单次重试允许的最大延迟，默认值为 `30000`。

***

### factor

> **factor**: `number`

定义于: [core/src/shared/types.ts:54](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L54)

每次重试的指数乘数，默认值为 `2`。

***

### jitter

> **jitter**: `number`

定义于: [core/src/shared/types.ts:56](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L56)

取值范围为 `0` 到 `1` 的随机抖动比例，默认值为 `0.2`。

***

### stableThreshold

> **stableThreshold**: `number`

定义于: [core/src/shared/types.ts:58](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L58)

连接连续保持 open 多久后重置重试计数，默认值为 `30000`。
