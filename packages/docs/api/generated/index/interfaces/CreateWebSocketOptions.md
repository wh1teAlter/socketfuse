# Interface: CreateWebSocketOptions\<Incoming, Outgoing, Auth\>

Defined in: [core/src/types.ts:331](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L331)

Configuration for a page client and its shared physical connection.

Options that affect physical socket behavior must match for clients reusing
an `id`. Page-local options are identified below and do not enter the shared
configuration fingerprint.

## Type Parameters

### Incoming

`Incoming` = [`SocketData`](../type-aliases/SocketData.md)

### Outgoing

`Outgoing` = [`SocketData`](../type-aliases/SocketData.md)

### Auth

`Auth` = `unknown`

## Properties

### id

> **id**: `string`

Defined in: [core/src/types.ts:333](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L333)

Stable application identity used to share a connection across same-origin tabs.

***

### protocols?

> `optional` **protocols?**: `string` \| readonly `string`[]

Defined in: [core/src/types.ts:335](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L335)

WebSocket subprotocol token or ordered tokens. Defaults to none.

***

### worker?

> `optional` **worker?**: () => `SharedWorker`

Defined in: [core/src/types.ts:337](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L337)

Page-local custom SharedWorker factory. Defaults to the built-in inline Worker.

#### Returns

`SharedWorker`

***

### protocol?

> `optional` **protocol?**: `ProtocolSelector`\<`Incoming`, `Outgoing`, `Auth`\>

Defined in: [core/src/types.ts:339](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L339)

Message protocol. Defaults to the raw adapter.

***

### fallback?

> `optional` **fallback?**: `"direct"` \| `"error"`

Defined in: [core/src/types.ts:341](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L341)

Page-local behavior when Worker setup fails. Defaults to `direct`.

***

### immediate?

> `optional` **immediate?**: `boolean`

Defined in: [core/src/types.ts:343](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L343)

Open immediately after creation. Page-local; defaults to `true`.

***

### autoClose?

> `optional` **autoClose?**: `boolean`

Defined in: [core/src/types.ts:345](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L345)

Detach automatically during page teardown. Page-local; defaults to `true`.

***

### autoReconnect?

> `optional` **autoReconnect?**: `boolean` \| `Partial`\<[`ReconnectOptions`](ReconnectOptions.md)\>

Defined in: [core/src/types.ts:347](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L347)

Shared reconnect policy. `true` or omission uses exponential defaults.

***

### connectionTimeout?

> `optional` **connectionTimeout?**: `number`

Defined in: [core/src/types.ts:349](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L349)

Shared open/handshake timeout in milliseconds. Defaults to `10000`.

***

### binaryType?

> `optional` **binaryType?**: `"arraybuffer"` \| `"blob"`

Defined in: [core/src/types.ts:351](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L351)

Shared binary receive representation. Defaults to `arraybuffer`.

***

### heartbeat?

> `optional` **heartbeat?**: `boolean` \| `Partial`\<[`HeartbeatOptions`](HeartbeatOptions.md)\>

Defined in: [core/src/types.ts:353](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L353)

Shared heartbeat policy. Disabled by default and requires adapter support.

***

### queue?

> `optional` **queue?**: `boolean` \| `Partial`\<[`QueueOptions`](QueueOptions.md)\>

Defined in: [core/src/types.ts:355](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L355)

Shared bounded outbound queue policy. Queueing is disabled by default.

***

### backpressure?

> `optional` **backpressure?**: `Partial`\<[`BackpressureOptions`](BackpressureOptions.md)\>

Defined in: [core/src/types.ts:357](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L357)

Shared buffered-amount thresholds.

***

### lease?

> `optional` **lease?**: `Partial`\<[`LeaseOptions`](LeaseOptions.md)\>

Defined in: [core/src/types.ts:359](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L359)

Shared client liveness lease.

***

### lifecycle?

> `optional` **lifecycle?**: [`LifecycleOptions`](LifecycleOptions.md)

Defined in: [core/src/types.ts:361](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L361)

Page-local freeze/restore handling. Disabled by default.

***

### limits?

> `optional` **limits?**: `Partial`\<[`ConnectionLimits`](ConnectionLimits.md)\>

Defined in: [core/src/types.ts:363](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L363)

Shared physical connection resource limits.

***

### idleGraceMs?

> `optional` **idleGraceMs?**: `number`

Defined in: [core/src/types.ts:365](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L365)

Delay before closing an unused physical socket, in milliseconds. Defaults to `5000`.

***

### logger?

> `optional` **logger?**: [`WwsLogger`](../type-aliases/WwsLogger.md)

Defined in: [core/src/types.ts:367](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L367)

Page-local sink for sanitized operational diagnostics.

***

### onConnected?

> `optional` **onConnected?**: (`client`, `snapshot`) => `void`

Defined in: [core/src/types.ts:369](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L369)

Page-local callback invoked when the logical client opens.

#### Parameters

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### snapshot

[`ConnectionSnapshot`](ConnectionSnapshot.md)

#### Returns

`void`

***

### onDisconnected?

> `optional` **onDisconnected?**: (`client`, `event`) => `void`

Defined in: [core/src/types.ts:371](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L371)

Page-local callback invoked when the logical client closes.

#### Parameters

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### event

[`WwsCloseEvent`](WwsCloseEvent.md)

#### Returns

`void`

***

### onError?

> `optional` **onError?**: (`client`, `error`) => `void`

Defined in: [core/src/types.ts:373](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L373)

Page-local callback invoked for a sanitized `WwsError`.

#### Parameters

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### error

[`WwsError`](../classes/WwsError.md)

#### Returns

`void`

***

### onMessage?

> `optional` **onMessage?**: (`client`, `event`) => `void`

Defined in: [core/src/types.ts:375](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L375)

Initial page-local business message callback; more can be added with `onMessage`.

#### Parameters

##### client

[`WebSocketClient`](WebSocketClient.md)\<`Incoming`, `Outgoing`, `Auth`\>

##### event

[`WwsMessageEvent`](WwsMessageEvent.md)\<`Incoming`\>

#### Returns

`void`
