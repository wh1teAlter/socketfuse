# Interface: JsonProtocolOptions

Defined in: [core/src/shared/types.ts:239](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L239)

Declarative JSON protocol definition shared by every tab using an `id`.

## Properties

### type

> `readonly` **type**: `"json"`

Defined in: [core/src/shared/types.ts:240](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L240)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [core/src/shared/types.ts:241](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L241)

***

### version?

> `readonly` `optional` **version?**: `number`

Defined in: [core/src/shared/types.ts:242](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L242)

***

### ready?

> `readonly` `optional` **ready?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>

Defined in: [core/src/shared/types.ts:243](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L243)

***

### auth?

> `readonly` `optional` **auth?**: [`JsonAuthTemplate`](JsonAuthTemplate.md)

Defined in: [core/src/shared/types.ts:244](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L244)

***

### heartbeat?

> `readonly` `optional` **heartbeat?**: [`JsonHeartbeatTemplate`](JsonHeartbeatTemplate.md)

Defined in: [core/src/shared/types.ts:245](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L245)

***

### ignore?

> `readonly` `optional` **ignore?**: readonly `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>[]

Defined in: [core/src/shared/types.ts:246](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L246)
