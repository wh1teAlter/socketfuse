# Type Alias: RevisionReceipt

> **RevisionReceipt** = \{ `status`: `"applied"`; `revision`: `number`; \} \| \{ `status`: `"stale"`; `revision`: `number`; \} \| \{ `status`: `"unchanged"`; `revision`: `number`; \}

Defined in: [core/src/types.ts:133](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L133)

Result of a monotonic endpoint or auth revision update.
