# Interface: WwsStateChangeEvent

Defined in: [core/src/shared/types.ts:169](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L169)

Detailed logical state transition notification.

## Extends

- `Event`

## Properties

### previous

> `readonly` **previous**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/shared/types.ts:170](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L170)

***

### state

> `readonly` **state**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/shared/types.ts:171](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L171)

***

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/shared/types.ts:172](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L172)

***

### attempt

> `readonly` **attempt**: `number`

Defined in: [core/src/shared/types.ts:173](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L173)

***

### reasonCode?

> `readonly` `optional` **reasonCode?**: `string`

Defined in: [core/src/shared/types.ts:174](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L174)
