# Interface: WwsMessageEvent\<Data\>

Defined in: [core/src/types.ts:145](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L145)

Business message delivered to page listeners. Protocol control frames are excluded.

## Extends

- `Event`

## Type Parameters

### Data

`Data`

## Properties

### data

> `readonly` **data**: `Data`

Defined in: [core/src/types.ts:147](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L147)

Decoded application payload.

***

### receivedAt

> `readonly` **receivedAt**: `number`

Defined in: [core/src/types.ts:149](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L149)

Receive timestamp in milliseconds since the Unix epoch.

***

### transport

> `readonly` **transport**: `"shared-worker"` \| `"direct"`

Defined in: [core/src/types.ts:151](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L151)

Transport that received the message.

***

### replayed

> `readonly` **replayed**: `boolean`

Defined in: [core/src/types.ts:153](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L153)

Whether lifecycle restore replayed this message.
