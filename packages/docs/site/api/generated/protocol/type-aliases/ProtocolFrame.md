# Type Alias: ProtocolFrame\<Data\>

> **ProtocolFrame**\<`Data`\> = \{ `type`: `"data"`; `data`: `Data`; \} \| \{ `type`: `"ready"`; \} \| \{ `type`: `"ping"`; `data`: `Data`; \} \| \{ `type`: `"pong"`; \} \| \{ `type`: `"ignore"`; \} \| \{ `type`: `"fatal"`; `code?`: `string`; \}

Defined in: [core/src/shared/types.ts:282](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L282)

Classification result separating business data from protocol control frames.

## Type Parameters

### Data

`Data`
