# Interface: SendOptions

Defined in: [core/src/types.ts:116](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L116)

Controls one `sendMessage` operation.

## Properties

### queue?

> `optional` **queue?**: `boolean`

Defined in: [core/src/types.ts:118](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L118)

Override shared queue eligibility for this send.

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [core/src/types.ts:120](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L120)

Application key retained with a queued message; WWS does not implement server Ack.
