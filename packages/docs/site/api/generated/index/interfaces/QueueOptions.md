# Interface: QueueOptions

Defined in: [core/src/shared/types.ts:61](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L61)

Shared bounded outbound queue policy.

## Properties

### whenDisconnected

> **whenDisconnected**: `boolean`

Defined in: [core/src/shared/types.ts:63](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L63)

Queue while the socket is disconnected. Defaults to `false`.

***

### whenBackpressured

> **whenBackpressured**: `boolean`

Defined in: [core/src/shared/types.ts:65](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L65)

Queue while buffered data is above the high-water mark. Defaults to `false`.

***

### maxMessages

> **maxMessages**: `number`

Defined in: [core/src/shared/types.ts:67](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L67)

Maximum queued message count. Defaults to `100`.

***

### maxBytes

> **maxBytes**: `number`

Defined in: [core/src/shared/types.ts:69](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L69)

Maximum encoded queue size. Defaults to 1 MiB.
