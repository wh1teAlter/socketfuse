# Interface: WwsStateChangeEvent

Defined in: [core/src/types.ts:169](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L169)

Detailed logical state transition notification.

## Extends

- `Event`

## Properties

### previous

> `readonly` **previous**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:170](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L170)

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:171](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L171)

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/types.ts:172](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L172)

***

### attempt

> `readonly` **attempt**: `number`

Defined in: [core/src/types.ts:173](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L173)

***

### reasonCode?

> `readonly` `optional` **reasonCode?**: `string`

Defined in: [core/src/types.ts:174](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L174)
