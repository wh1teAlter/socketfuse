# Interface: SharedWebSocketRuntime

Defined in: [core/src/worker-runtime.ts:59](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L59)

SharedWorker-side runtime that accepts page ports and owns connections.

## Properties

### instanceId

> `readonly` **instanceId**: `string`

Defined in: [core/src/worker-runtime.ts:60](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L60)

***

### connect

> **connect**: (`port`) => `void`

Defined in: [core/src/worker-runtime.ts:61](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L61)

#### Parameters

##### port

[`MessagePortLike`](MessagePortLike.md)

#### Returns

`void`

***

### dispose

> **dispose**: () => `void`

Defined in: [core/src/worker-runtime.ts:62](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L62)

#### Returns

`void`
