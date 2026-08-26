# 接口: QueueOptions

定义于: [core/src/shared/types.ts:76](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L76)

多标签页共享且有边界的出站队列策略。

## 属性

### whenDisconnected

> **whenDisconnected**: `boolean`

定义于: [core/src/shared/types.ts:78](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L78)

socket 未连接时是否允许入队，默认值为 `false`。

***

### whenBackpressured

> **whenBackpressured**: `boolean`

定义于: [core/src/shared/types.ts:80](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L80)

`bufferedAmount` 超过高水位时是否允许入队，默认值为 `false`。

***

### maxMessages

> **maxMessages**: `number`

定义于: [core/src/shared/types.ts:82](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L82)

队列可持有的最大消息数，默认值为 `100`。

***

### maxBytes

> **maxBytes**: `number`

定义于: [core/src/shared/types.ts:84](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L84)

编码后队列可持有的最大字节数，默认值为 1 MiB。
