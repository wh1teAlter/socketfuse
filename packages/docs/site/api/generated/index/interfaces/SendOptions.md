# Interface: SendOptions

Defined in: [core/src/shared/types.ts:120](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L120)

Controls one `sendMessage` operation.

## Properties

### queue?

> `optional` **queue?**: `boolean`

Defined in: [core/src/shared/types.ts:122](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L122)

Override shared queue eligibility for this send.

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [core/src/shared/types.ts:124](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L124)

Application key retained with a queued message; WWS does not implement server Ack.
