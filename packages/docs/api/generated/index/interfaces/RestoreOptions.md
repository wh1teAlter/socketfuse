# Interface: RestoreOptions

Defined in: [core/src/types.ts:94](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L94)

Page-local buffering used while a lifecycle-aware page is suspended.

## Properties

### replay?

> `optional` **replay?**: `boolean`

Defined in: [core/src/types.ts:96](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L96)

Replay buffered messages through `onMessage` on restore. Defaults to `false`.

***

### maxMessages?

> `optional` **maxMessages?**: `number`

Defined in: [core/src/types.ts:98](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L98)

Maximum buffered messages. Defaults to `256`.

***

### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [core/src/types.ts:100](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L100)

Maximum buffered bytes. Defaults to 4 MiB.
