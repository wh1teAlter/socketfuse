# 接口: SendOptions

定义于: [core/src/shared/types.ts:150](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L150)

控制一次 `sendMessage` 调用的页面本地选项。

## 属性

### queue?

> `optional` **queue?**: `boolean`

定义于: [core/src/shared/types.ts:152](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L152)

覆盖本次发送是否可按共享队列策略入队。

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

定义于: [core/src/shared/types.ts:154](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L154)

随排队消息保留的业务幂等键；WWS 不将其解释为服务端 Ack。
