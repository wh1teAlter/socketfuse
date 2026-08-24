# Type Alias: SendReceipt

> **SendReceipt** = \{ `status`: `"accepted"`; `messageId`: `string`; `bufferedAmount`: `number`; \} \| \{ `status`: `"queued"`; `messageId`: `string`; `position`: `number`; \}

Defined in: [core/src/types.ts:128](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L128)

Local acceptance result from `sendMessage`; it is not a server delivery receipt.
