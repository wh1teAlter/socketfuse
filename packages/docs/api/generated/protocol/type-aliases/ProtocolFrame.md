# Type Alias: ProtocolFrame\<Data\>

> **ProtocolFrame**\<`Data`\> = \{ `type`: `"data"`; `data`: `Data`; \} \| \{ `type`: `"ready"`; \} \| \{ `type`: `"ping"`; `data`: `Data`; \} \| \{ `type`: `"pong"`; \} \| \{ `type`: `"ignore"`; \} \| \{ `type`: `"fatal"`; `code?`: `string`; \}

Defined in: [core/src/types.ts:282](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/types.ts#L282)

Classification result separating business data from protocol control frames.

## Type Parameters

### Data

`Data`
