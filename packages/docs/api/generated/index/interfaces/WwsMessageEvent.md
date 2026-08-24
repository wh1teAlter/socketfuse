# Interface: WwsMessageEvent\<Data\>

Defined in: [core/src/types.ts:149](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L149)

Business message delivered to page listeners. Protocol control frames are excluded.

## Extends

- `Event`

## Type Parameters

### Data

`Data`

## Properties

### data

> `readonly` **data**: `Data`

Defined in: [core/src/types.ts:151](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L151)

Decoded application payload.

***

### receivedAt

> `readonly` **receivedAt**: `number`

Defined in: [core/src/types.ts:153](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L153)

Receive timestamp in milliseconds since the Unix epoch.

***

### transport

> `readonly` **transport**: `"shared-worker"` \| `"direct"`

Defined in: [core/src/types.ts:155](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L155)

Transport that received the message.

***

### replayed

> `readonly` **replayed**: `boolean`

Defined in: [core/src/types.ts:157](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L157)

Whether lifecycle restore replayed this message.
