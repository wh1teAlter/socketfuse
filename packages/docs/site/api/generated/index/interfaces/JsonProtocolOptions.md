# 接口: JsonProtocolOptions

定义于: [core/src/shared/types.ts:343](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L343)

同一 `id` 的每个标签页共享的声明式 JSON 协议定义。

## 属性

### type

> `readonly` **type**: `"json"`

定义于: [core/src/shared/types.ts:345](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L345)

固定为 JSON 协议选择器。

***

### id?

> `readonly` `optional` **id?**: `string`

定义于: [core/src/shared/types.ts:347](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L347)

可选的稳定适配器 id；默认使用内置 JSON id。

***

### version?

> `readonly` `optional` **version?**: `number`

定义于: [core/src/shared/types.ts:349](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L349)

可选的适配器 major 版本；变更会触发共享配置冲突。

***

### ready?

> `readonly` `optional` **ready?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>

定义于: [core/src/shared/types.ts:351](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L351)

将入站帧标记为 ready 的匹配器。

***

### auth?

> `readonly` `optional` **auth?**: [`JsonAuthTemplate`](JsonAuthTemplate.md)

定义于: [core/src/shared/types.ts:353](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L353)

根据最新 auth revision 生成认证帧的模板。

***

### heartbeat?

> `readonly` `optional` **heartbeat?**: [`JsonHeartbeatTemplate`](JsonHeartbeatTemplate.md)

定义于: [core/src/shared/types.ts:355](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L355)

该协议的应用层心跳定义。

***

### ignore?

> `readonly` `optional` **ignore?**: readonly `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>[]

定义于: [core/src/shared/types.ts:357](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L357)

被协议消费、不会派发给业务的入站帧匹配器。
