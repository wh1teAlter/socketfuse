# Interface: ProtocolAdapter\<Incoming, Outgoing, Auth\>

Defined in: [core/src/types.ts:303](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L303)

Defines encoding and control-frame semantics for one application protocol.

Adapter functions execute inside a custom Worker and never cross MessagePort.
`id`, `version`, capabilities, readiness and `sharedConfig` form the shared
protocol identity used for connection conflict detection.

## Type Parameters

### Incoming

`Incoming`

Decoded business payload delivered to page listeners.

### Outgoing

`Outgoing`

Application value accepted by `sendMessage`.

### Auth

`Auth` = `unknown`

Revisioned authentication value accepted by `updateAuth`.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [core/src/types.ts:304](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L304)

***

### version

> `readonly` **version**: `number`

Defined in: [core/src/types.ts:305](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L305)

***

### capabilities

> `readonly` **capabilities**: [`ProtocolCapabilities`](../../index/interfaces/ProtocolCapabilities.md)

Defined in: [core/src/types.ts:306](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L306)

***

### sharedConfig?

> `readonly` `optional` **sharedConfig?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [core/src/types.ts:307](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L307)

***

### readyWhen?

> `readonly` `optional` **readyWhen?**: `"socket-open"` \| `"adapter-frame"`

Defined in: [core/src/types.ts:308](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L308)

***

### encode

> **encode**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<[`SocketData`](../../index/type-aliases/SocketData.md)\>

Defined in: [core/src/types.ts:309](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L309)

#### Parameters

##### data

`Outgoing`

##### context

[`EncodeContext`](EncodeContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<[`SocketData`](../../index/type-aliases/SocketData.md)\>

***

### decode

> **decode**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Incoming`\>

Defined in: [core/src/types.ts:310](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L310)

#### Parameters

##### data

[`SocketData`](../../index/type-aliases/SocketData.md)

##### context

[`DecodeContext`](DecodeContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Incoming`\>

***

### classify

> **classify**: (`data`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>\>

Defined in: [core/src/types.ts:311](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L311)

#### Parameters

##### data

`Incoming`

##### context

[`ClassifyContext`](ClassifyContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>\>

***

### createAuth?

> `optional` **createAuth?**: (`auth`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing` \| readonly `Outgoing`[]\>

Defined in: [core/src/types.ts:312](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L312)

#### Parameters

##### auth

`Auth`

##### context

[`AuthContext`](AuthContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing` \| readonly `Outgoing`[]\>

***

### createPing?

> `optional` **createPing?**: (`context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

Defined in: [core/src/types.ts:313](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L313)

#### Parameters

##### context

[`HeartbeatContext`](HeartbeatContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

***

### createPong?

> `optional` **createPong?**: (`ping`, `context`) => [`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

Defined in: [core/src/types.ts:314](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L314)

#### Parameters

##### ping

[`ProtocolFrame`](../type-aliases/ProtocolFrame.md)\<`Incoming`\>

##### context

[`HeartbeatContext`](HeartbeatContext.md)

#### Returns

[`MaybePromise`](../type-aliases/MaybePromise.md)\<`Outgoing`\>

***

### shouldReconnect?

> `optional` **shouldReconnect?**: (`close`) => `boolean`

Defined in: [core/src/types.ts:315](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L315)

#### Parameters

##### close

[`SafeCloseInfo`](SafeCloseInfo.md)

#### Returns

`boolean`
