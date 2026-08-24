# Interface: JsonProtocolOptions

Defined in: [core/src/types.ts:239](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L239)

Declarative JSON protocol definition shared by every tab using an `id`.

## Properties

### type

> `readonly` **type**: `"json"`

Defined in: [core/src/types.ts:240](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L240)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [core/src/types.ts:241](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L241)

***

### version?

> `readonly` `optional` **version?**: `number`

Defined in: [core/src/types.ts:242](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L242)

***

### ready?

> `readonly` `optional` **ready?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>

Defined in: [core/src/types.ts:243](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L243)

***

### auth?

> `readonly` `optional` **auth?**: [`JsonAuthTemplate`](JsonAuthTemplate.md)

Defined in: [core/src/types.ts:244](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L244)

***

### heartbeat?

> `readonly` `optional` **heartbeat?**: [`JsonHeartbeatTemplate`](JsonHeartbeatTemplate.md)

Defined in: [core/src/types.ts:245](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L245)

***

### ignore?

> `readonly` `optional` **ignore?**: readonly `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>[]

Defined in: [core/src/types.ts:246](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L246)
