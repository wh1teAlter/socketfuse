# Interface: WwsStateChangeEvent

Defined in: [core/src/types.ts:165](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L165)

Detailed logical state transition notification.

## Extends

- `Event`

## Properties

### previous

> `readonly` **previous**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:166](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L166)

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:167](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L167)

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/types.ts:168](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L168)

***

### attempt

> `readonly` **attempt**: `number`

Defined in: [core/src/types.ts:169](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L169)

***

### reasonCode?

> `readonly` `optional` **reasonCode?**: `string`

Defined in: [core/src/types.ts:170](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L170)
