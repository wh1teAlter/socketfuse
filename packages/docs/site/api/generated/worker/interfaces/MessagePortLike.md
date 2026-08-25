# Interface: MessagePortLike

Defined in: [core/src/worker/runtime.ts:12](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L12)

Minimal MessagePort surface used by the custom Worker runtime.

## Properties

### postMessage

> **postMessage**: (`message`) => `void`

Defined in: [core/src/worker/runtime.ts:13](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L13)

#### Parameters

##### message

`unknown`

#### Returns

`void`

***

### start?

> `optional` **start?**: () => `void`

Defined in: [core/src/worker/runtime.ts:14](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L14)

#### Returns

`void`

***

### close?

> `optional` **close?**: () => `void`

Defined in: [core/src/worker/runtime.ts:15](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L15)

#### Returns

`void`

***

### addEventListener?

> `optional` **addEventListener?**: (`type`, `listener`) => `void`

Defined in: [core/src/worker/runtime.ts:16](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L16)

#### Parameters

##### type

`"message"` \| `"messageerror"`

##### listener

(`event`) => `void`

#### Returns

`void`

***

### removeEventListener?

> `optional` **removeEventListener?**: (`type`, `listener`) => `void`

Defined in: [core/src/worker/runtime.ts:17](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L17)

#### Parameters

##### type

`"message"` \| `"messageerror"`

##### listener

(`event`) => `void`

#### Returns

`void`

***

### onmessage?

> `optional` **onmessage?**: ((`event`) => `void`) \| `null`

Defined in: [core/src/worker/runtime.ts:18](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L18)

***

### onmessageerror?

> `optional` **onmessageerror?**: ((`event`) => `void`) \| `null`

Defined in: [core/src/worker/runtime.ts:19](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L19)
