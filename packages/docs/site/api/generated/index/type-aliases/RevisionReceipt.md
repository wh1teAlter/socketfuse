# Type Alias: RevisionReceipt

> **RevisionReceipt** = \{ `status`: `"applied"`; `revision`: `number`; \} \| \{ `status`: `"stale"`; `revision`: `number`; \} \| \{ `status`: `"unchanged"`; `revision`: `number`; \}

Defined in: [core/src/shared/types.ts:133](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L133)

Result of a monotonic endpoint or auth revision update.
