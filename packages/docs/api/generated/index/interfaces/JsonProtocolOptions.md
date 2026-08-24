# Interface: JsonProtocolOptions

Defined in: [core/src/types.ts:235](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L235)

Declarative JSON protocol definition shared by every tab using an `id`.

## Properties

### type

> `readonly` **type**: `"json"`

Defined in: [core/src/types.ts:236](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L236)

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [core/src/types.ts:237](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L237)

***

### version?

> `readonly` `optional` **version?**: `number`

Defined in: [core/src/types.ts:238](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L238)

***

### ready?

> `readonly` `optional` **ready?**: `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>

Defined in: [core/src/types.ts:239](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L239)

***

### auth?

> `readonly` `optional` **auth?**: [`JsonAuthTemplate`](JsonAuthTemplate.md)

Defined in: [core/src/types.ts:240](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L240)

***

### heartbeat?

> `readonly` `optional` **heartbeat?**: [`JsonHeartbeatTemplate`](JsonHeartbeatTemplate.md)

Defined in: [core/src/types.ts:241](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L241)

***

### ignore?

> `readonly` `optional` **ignore?**: readonly `Readonly`\<`Record`\<`string`, [`JsonValue`](../type-aliases/JsonValue.md)\>\>[]

Defined in: [core/src/types.ts:242](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L242)
