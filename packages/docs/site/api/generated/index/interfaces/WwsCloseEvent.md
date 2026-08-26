# 接口: WwsCloseEvent

定义于: [core/src/shared/types.ts:226](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L226)

当前页面逻辑 client 的关闭通知。

## 继承

- `Event`

## 属性

### code

> `readonly` **code**: `number`

定义于: [core/src/shared/types.ts:228](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L228)

经安全化后暴露的 WebSocket close code。

***

### wasClean

> `readonly` **wasClean**: `boolean`

定义于: [core/src/shared/types.ts:230](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L230)

原生 close 事件是否标记为 clean。

***

### terminal

> `readonly` **terminal**: `boolean`

定义于: [core/src/shared/types.ts:232](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L232)

是否已进入不会再次打开的终态。

***

### willReconnect

> `readonly` **willReconnect**: `boolean`

定义于: [core/src/shared/types.ts:234](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/types.ts#L234)

当前共享连接是否将自行发起重连。
