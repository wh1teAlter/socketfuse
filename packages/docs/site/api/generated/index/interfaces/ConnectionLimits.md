# 接口: ConnectionLimits

定义于: [core/src/shared/types.ts:104](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L104)

仅属于一条共享物理 WebSocket 的资源上限。

## 属性

### maxClientsPerConnection

> **maxClientsPerConnection**: `number`

定义于: [core/src/shared/types.ts:106](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L106)

同一连接可同时附着的逻辑 client 上限。

***

### maxEncodedMessageBytes

> **maxEncodedMessageBytes**: `number`

定义于: [core/src/shared/types.ts:108](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L108)

单条编码出站消息允许的最大字节数。
