# Interface: SharedWebSocketRuntime

Defined in: [core/src/worker/runtime.ts:59](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L59)

SharedWorker-side runtime that accepts page ports and owns connections.

## Properties

### instanceId

> `readonly` **instanceId**: `string`

Defined in: [core/src/worker/runtime.ts:60](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L60)

***

### connect

> **connect**: (`port`) => `void`

Defined in: [core/src/worker/runtime.ts:61](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L61)

#### Parameters

##### port

[`MessagePortLike`](MessagePortLike.md)

#### Returns

`void`

***

### dispose

> **dispose**: () => `void`

Defined in: [core/src/worker/runtime.ts:62](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L62)

#### Returns

`void`
