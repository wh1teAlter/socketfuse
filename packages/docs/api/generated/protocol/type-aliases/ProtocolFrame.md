# Type Alias: ProtocolFrame\<Data\>

> **ProtocolFrame**\<`Data`\> = \{ `type`: `"data"`; `data`: `Data`; \} \| \{ `type`: `"ready"`; \} \| \{ `type`: `"ping"`; `data`: `Data`; \} \| \{ `type`: `"pong"`; \} \| \{ `type`: `"ignore"`; \} \| \{ `type`: `"fatal"`; `code?`: `string`; \}

Defined in: [core/src/types.ts:278](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L278)

Classification result separating business data from protocol control frames.

## Type Parameters

### Data

`Data`
