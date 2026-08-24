# Interface: QueueOptions

Defined in: [core/src/types.ts:61](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L61)

Shared bounded outbound queue policy.

## Properties

### whenDisconnected

> **whenDisconnected**: `boolean`

Defined in: [core/src/types.ts:63](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L63)

Queue while the socket is disconnected. Defaults to `false`.

***

### whenBackpressured

> **whenBackpressured**: `boolean`

Defined in: [core/src/types.ts:65](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L65)

Queue while buffered data is above the high-water mark. Defaults to `false`.

***

### maxMessages

> **maxMessages**: `number`

Defined in: [core/src/types.ts:67](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L67)

Maximum queued message count. Defaults to `100`.

***

### maxBytes

> **maxBytes**: `number`

Defined in: [core/src/types.ts:69](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L69)

Maximum encoded queue size. Defaults to 1 MiB.
