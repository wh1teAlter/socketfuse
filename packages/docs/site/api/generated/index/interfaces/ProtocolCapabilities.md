# 接口: ProtocolCapabilities

定义于: [core/src/shared/types.ts:36](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L36)

选定协议适配器实现的能力集合。

## 属性

### auth

> `readonly` **auth**: `boolean`

定义于: [core/src/shared/types.ts:38](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L38)

是否能根据 revision 生成认证帧。

***

### heartbeat

> `readonly` **heartbeat**: `boolean`

定义于: [core/src/shared/types.ts:40](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L40)

是否能生成和识别应用层心跳帧。

***

### binary

> `readonly` **binary**: `boolean`

定义于: [core/src/shared/types.ts:42](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/shared/types.ts#L42)

是否能安全处理二进制 WebSocket payload。
