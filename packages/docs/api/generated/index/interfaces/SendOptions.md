# Interface: SendOptions

Defined in: [core/src/types.ts:120](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L120)

Controls one `sendMessage` operation.

## Properties

### queue?

> `optional` **queue?**: `boolean`

Defined in: [core/src/types.ts:122](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L122)

Override shared queue eligibility for this send.

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [core/src/types.ts:124](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L124)

Application key retained with a queued message; WWS does not implement server Ack.
