# 接口: JsonHeartbeatTemplate

定义于: [core/src/shared/types.ts:331](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L331)

声明式 JSON ping/pong 模板与匹配器。

## 属性

### ping

> `readonly` **ping**: [`JsonValue`](../type-aliases/JsonValue.md)

定义于: [core/src/shared/types.ts:333](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L333)

客户端主动发送的 ping 帧。

***

### pong

> `readonly` **pong**: [`JsonMatcher`](../type-aliases/JsonMatcher.md)

定义于: [core/src/shared/types.ts:335](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L335)

用于识别服务端 pong 的匹配器。

***

### serverPing?

> `readonly` `optional` **serverPing?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>

定义于: [core/src/shared/types.ts:337](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L337)

可选的服务端 ping 匹配器。

***

### serverPong?

> `readonly` `optional` **serverPong?**: [`JsonValue`](../type-aliases/JsonValue.md)

定义于: [core/src/shared/types.ts:339](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/shared/types.ts#L339)

收到 serverPing 后返回的 pong 帧。
