# Interface: ConnectionDiagnostics

Defined in: [core/src/shared/types.ts:197](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L197)

Sanitized point-in-time metrics for a logical and physical connection.

## Properties

### transport

> `readonly` **transport**: [`Transport`](../type-aliases/Transport.md)

Defined in: [core/src/shared/types.ts:198](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L198)

***

### logicalState

> `readonly` **logicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/shared/types.ts:199](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L199)

***

### physicalState

> `readonly` **physicalState**: [`ConnectionState`](../type-aliases/ConnectionState.md)

Defined in: [core/src/shared/types.ts:200](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L200)

***

### workerInstanceHash

> `readonly` **workerInstanceHash**: `string` \| `null`

Defined in: [core/src/shared/types.ts:201](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L201)

***

### controlProtocolMajor

> `readonly` **controlProtocolMajor**: `number`

Defined in: [core/src/shared/types.ts:202](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L202)

***

### idHash

> `readonly` **idHash**: `string`

Defined in: [core/src/shared/types.ts:203](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L203)

***

### configFingerprint

> `readonly` **configFingerprint**: `string`

Defined in: [core/src/shared/types.ts:204](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L204)

***

### endpointOrigin

> `readonly` **endpointOrigin**: `string`

Defined in: [core/src/shared/types.ts:205](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L205)

***

### retryAttempt

> `readonly` **retryAttempt**: `number`

Defined in: [core/src/shared/types.ts:206](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L206)

***

### nextRetryDelay

> `readonly` **nextRetryDelay**: `number` \| `null`

Defined in: [core/src/shared/types.ts:207](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L207)

***

### lastSafeCloseCode

> `readonly` **lastSafeCloseCode**: `number` \| `null`

Defined in: [core/src/shared/types.ts:208](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L208)

***

### attachedClientCount

> `readonly` **attachedClientCount**: `number`

Defined in: [core/src/shared/types.ts:209](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L209)

***

### queueMessages

> `readonly` **queueMessages**: `number`

Defined in: [core/src/shared/types.ts:210](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L210)

***

### queueBytes

> `readonly` **queueBytes**: `number`

Defined in: [core/src/shared/types.ts:211](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L211)

***

### bufferedAmount

> `readonly` **bufferedAmount**: `number`

Defined in: [core/src/shared/types.ts:212](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L212)

***

### outboundHighWater

> `readonly` **outboundHighWater**: `boolean`

Defined in: [core/src/shared/types.ts:213](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L213)

***

### lastErrorCode

> `readonly` **lastErrorCode**: `string` \| `null`

Defined in: [core/src/shared/types.ts:214](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/types.ts#L214)
