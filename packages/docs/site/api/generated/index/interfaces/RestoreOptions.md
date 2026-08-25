# Interface: RestoreOptions

Defined in: [core/src/shared/types.ts:98](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L98)

Page-local buffering used while a lifecycle-aware page is suspended.

## Properties

### replay?

> `optional` **replay?**: `boolean`

Defined in: [core/src/shared/types.ts:100](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L100)

Replay buffered messages through `onMessage` on restore. Defaults to `false`.

***

### maxMessages?

> `optional` **maxMessages?**: `number`

Defined in: [core/src/shared/types.ts:102](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L102)

Maximum buffered messages. Defaults to `256`.

***

### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [core/src/shared/types.ts:104](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L104)

Maximum buffered bytes. Defaults to 4 MiB.
