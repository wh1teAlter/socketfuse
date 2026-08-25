# Type Alias: SendReceipt

> **SendReceipt** = \{ `status`: `"accepted"`; `messageId`: `string`; `bufferedAmount`: `number`; \} \| \{ `status`: `"queued"`; `messageId`: `string`; `position`: `number`; \}

Defined in: [core/src/shared/types.ts:128](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L128)

Local acceptance result from `sendMessage`; it is not a server delivery receipt.
