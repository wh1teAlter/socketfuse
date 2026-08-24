# Type Alias: SendReceipt

> **SendReceipt** = \{ `status`: `"accepted"`; `messageId`: `string`; `bufferedAmount`: `number`; \} \| \{ `status`: `"queued"`; `messageId`: `string`; `position`: `number`; \}

Defined in: [core/src/types.ts:124](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L124)

Local acceptance result from `sendMessage`; it is not a server delivery receipt.
