# Type Alias: RevisionReceipt

> **RevisionReceipt** = \{ `status`: `"applied"`; `revision`: `number`; \} \| \{ `status`: `"stale"`; `revision`: `number`; \} \| \{ `status`: `"unchanged"`; `revision`: `number`; \}

Defined in: [core/src/types.ts:129](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L129)

Result of a monotonic endpoint or auth revision update.
