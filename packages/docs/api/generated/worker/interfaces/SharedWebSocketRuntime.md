# Interface: SharedWebSocketRuntime

Defined in: [core/src/worker-runtime.ts:52](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L52)

SharedWorker-side runtime that accepts page ports and owns connections.

## Properties

### instanceId

> `readonly` **instanceId**: `string`

Defined in: [core/src/worker-runtime.ts:53](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L53)

***

### connect

> **connect**: (`port`) => `void`

Defined in: [core/src/worker-runtime.ts:54](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L54)

#### Parameters

##### port

[`MessagePortLike`](MessagePortLike.md)

#### Returns

`void`

***

### dispose

> **dispose**: () => `void`

Defined in: [core/src/worker-runtime.ts:55](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L55)

#### Returns

`void`
