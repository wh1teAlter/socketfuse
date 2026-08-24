# Interface: RestoreOptions

Defined in: [core/src/types.ts:98](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L98)

Page-local buffering used while a lifecycle-aware page is suspended.

## Properties

### replay?

> `optional` **replay?**: `boolean`

Defined in: [core/src/types.ts:100](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L100)

Replay buffered messages through `onMessage` on restore. Defaults to `false`.

***

### maxMessages?

> `optional` **maxMessages?**: `number`

Defined in: [core/src/types.ts:102](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L102)

Maximum buffered messages. Defaults to `256`.

***

### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [core/src/types.ts:104](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L104)

Maximum buffered bytes. Defaults to 4 MiB.
