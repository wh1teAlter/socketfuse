# 接口: WorkerResourceLimits

定义于: [core/src/shared/types.ts:112](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L112)

保护一个 SharedWorker 控制平面的静态资源上限。

## 属性

### maxPorts

> **maxPorts**: `number`

定义于: [core/src/shared/types.ts:114](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L114)

Worker 可接受的 MessagePort 总数上限。

***

### maxControlEnvelopeBytes

> **maxControlEnvelopeBytes**: `number`

定义于: [core/src/shared/types.ts:116](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L116)

单个 page-to-Worker 控制 envelope 的最大结构化克隆字节数。

***

### unattachedPortTimeoutMs

> **unattachedPortTimeoutMs**: `number`

定义于: [core/src/shared/types.ts:118](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L118)

端口建立后未完成 hello 时的回收时限，单位为毫秒。
