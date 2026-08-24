# Interface: WebSocketClient\<Incoming, Outgoing, Auth\>

Defined in: [core/src/types.ts:385](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L385)

Page-local proxy for a SharedWorker-owned or direct WebSocket connection.

## Extends

- `EventTarget`

## Type Parameters

### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

Decoded business payload delivered by `onMessage`.

### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

Application value accepted by `sendMessage`.

### Auth

`Auth` = `unknown`

Revisioned authentication value accepted by `updateAuth`.

## Properties

### data

> `readonly` **data**: `Incoming` \| `null`

Defined in: [core/src/types.ts:387](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L387)

Most recently delivered business payload, or `null` before the first message.

***

### status

> `readonly` **status**: [`WebSocketStatus`](../type-aliases/WebSocketStatus.md)

Defined in: [core/src/types.ts:389](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L389)

Compact `CONNECTING`, `OPEN` or `CLOSED` status.

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:391](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L391)

Detailed logical lifecycle state.

***

### readyState

> `readonly` **readyState**: [`ReadyState`](../type-aliases/ReadyState.md)

Defined in: [core/src/types.ts:393](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L393)

Native WebSocket-compatible numeric ready state.

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/types.ts:395](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L395)

Currently selected transport.

***

### workerMode

> `readonly` **workerMode**: [`WorkerMode`](../type-aliases/WorkerMode.md)

Defined in: [core/src/types.ts:397](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L397)

Inline, custom or no Worker deployment mode.

***

### capabilities

> `readonly` **capabilities**: [`ProtocolCapabilities`](ProtocolCapabilities.md)

Defined in: [core/src/types.ts:399](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L399)

Capabilities declared by the selected protocol adapter.

***

### open

> **open**: (`options?`) => `Promise`\<[`ConnectionSnapshot`](ConnectionSnapshot.md)\>

Defined in: [core/src/types.ts:401](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L401)

Open the logical client; multiple callers share the in-flight operation.

#### Parameters

##### options?

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`ConnectionSnapshot`](ConnectionSnapshot.md)\>

***

### close

> **close**: () => `Promise`\<`void`\>

Defined in: [core/src/types.ts:403](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L403)

Close this page's logical participation without disposing the instance.

#### Returns

`Promise`\<`void`\>

***

### sendMessage

> **sendMessage**: (`data`, `options?`) => `Promise`\<[`SendReceipt`](../type-aliases/SendReceipt.md)\>

Defined in: [core/src/types.ts:405](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L405)

Submit or queue one message and resolve with a local acceptance receipt.

#### Parameters

##### data

`Outgoing`

##### options?

[`SendOptions`](SendOptions.md)

#### Returns

`Promise`\<[`SendReceipt`](../type-aliases/SendReceipt.md)\>

***

### onMessage

> **onMessage**: (`handler`) => () => `void`

Defined in: [core/src/types.ts:407](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L407)

Add a dynamic business message handler and return its removal function.

#### Parameters

##### handler

(`event`) => `void`

#### Returns

() => `void`

***

### updateAuth

> **updateAuth**: (`auth`, `options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

Defined in: [core/src/types.ts:409](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L409)

Apply authentication data when `revision` is newer than the shared register.

#### Parameters

##### auth

`Auth`

##### options

###### revision

`number`

#### Returns

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

***

### clearAuth

> **clearAuth**: (`options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

Defined in: [core/src/types.ts:411](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L411)

Clear authentication and pending business data using a newer revision.

#### Parameters

##### options

###### revision

`number`

#### Returns

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

***

### updateUrl

> **updateUrl**: (`url`, `options`) => `Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

Defined in: [core/src/types.ts:413](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L413)

Apply a new endpoint using the shared monotonic endpoint register.

#### Parameters

##### url

`string` \| `URL`

##### options

###### revision

`number`

#### Returns

`Promise`\<[`RevisionReceipt`](../type-aliases/RevisionReceipt.md)\>

***

### reconnect

> **reconnect**: (`options?`) => `Promise`\<`void`\>

Defined in: [core/src/types.ts:415](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L415)

Explicitly start a new connection attempt.

#### Parameters

##### options?

###### reason?

`string`

#### Returns

`Promise`\<`void`\>

***

### diagnostics

> **diagnostics**: () => `Readonly`\<[`ConnectionDiagnostics`](ConnectionDiagnostics.md)\>

Defined in: [core/src/types.ts:417](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L417)

Return sanitized operational metrics without auth, query or payload data.

#### Returns

`Readonly`\<[`ConnectionDiagnostics`](ConnectionDiagnostics.md)\>

***

### dispose

> **dispose**: () => `Promise`\<`void`\>

Defined in: [core/src/types.ts:419](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L419)

Permanently release the client, handlers and transport participation.

#### Returns

`Promise`\<`void`\>
