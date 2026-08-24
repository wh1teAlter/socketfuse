# Interface: ConnectionDiagnostics

Defined in: [core/src/types.ts:193](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L193)

Sanitized point-in-time metrics for a logical and physical connection.

## Properties

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/types.ts:194](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L194)

***

### logicalState

> `readonly` **logicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:195](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L195)

***

### physicalState

> `readonly` **physicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/types.ts:196](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L196)

***

### workerInstanceHash

> `readonly` **workerInstanceHash**: `string` \| `null`

Defined in: [core/src/types.ts:197](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L197)

***

### controlProtocolMajor

> `readonly` **controlProtocolMajor**: `number`

Defined in: [core/src/types.ts:198](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L198)

***

### idHash

> `readonly` **idHash**: `string`

Defined in: [core/src/types.ts:199](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L199)

***

### configFingerprint

> `readonly` **configFingerprint**: `string`

Defined in: [core/src/types.ts:200](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L200)

***

### endpointOrigin

> `readonly` **endpointOrigin**: `string`

Defined in: [core/src/types.ts:201](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L201)

***

### retryAttempt

> `readonly` **retryAttempt**: `number`

Defined in: [core/src/types.ts:202](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L202)

***

### nextRetryDelay

> `readonly` **nextRetryDelay**: `number` \| `null`

Defined in: [core/src/types.ts:203](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L203)

***

### lastSafeCloseCode

> `readonly` **lastSafeCloseCode**: `number` \| `null`

Defined in: [core/src/types.ts:204](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L204)

***

### attachedClientCount

> `readonly` **attachedClientCount**: `number`

Defined in: [core/src/types.ts:205](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L205)

***

### queueMessages

> `readonly` **queueMessages**: `number`

Defined in: [core/src/types.ts:206](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L206)

***

### queueBytes

> `readonly` **queueBytes**: `number`

Defined in: [core/src/types.ts:207](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L207)

***

### bufferedAmount

> `readonly` **bufferedAmount**: `number`

Defined in: [core/src/types.ts:208](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L208)

***

### outboundHighWater

> `readonly` **outboundHighWater**: `boolean`

Defined in: [core/src/types.ts:209](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L209)

***

### lastErrorCode

> `readonly` **lastErrorCode**: `string` \| `null`

Defined in: [core/src/types.ts:210](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L210)
