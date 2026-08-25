# Class: WwsError

Defined in: [core/src/shared/errors.ts:61](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L61)

Error contract used by rejected operations and error callbacks.

Prefer `code` over matching `message`. Details are sanitized before errors
cross the Worker boundary or reach page callbacks.

## Extends

- `Error`

## Constructors

### Constructor

> **new WwsError**(`code`, `message`, `options?`): `WwsError`

Defined in: [core/src/shared/errors.ts:69](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L69)

#### Parameters

##### code

`"INVALID_OPTIONS"` \| `"ENVIRONMENT_UNSUPPORTED"` \| `"CLIENT_DISPOSED"` \| `"CLIENT_DISCONNECTED"` \| `"ABORTED"` \| `"WORKER_UNSUPPORTED"` \| `"WORKER_CONSTRUCTION_FAILED"` \| `"WORKER_LOAD_FAILED"` \| `"WORKER_INIT_TIMEOUT"` \| `"WORKER_DISCONNECTED"` \| `"PROTOCOL_VERSION_MISMATCH"` \| `"ADAPTER_NOT_REGISTERED"` \| `"INVALID_CONTROL_MESSAGE"` \| `"CONNECTION_CONFIG_CONFLICT"` \| `"CONNECTION_TIMEOUT"` \| `"SOCKET_ERROR"` \| `"CLOSE_NOT_RETRYABLE"` \| `"RETRY_EXHAUSTED"` \| `"HEARTBEAT_TIMEOUT"` \| `"AUTH_FAILED"` \| `"STALE_REVISION"` \| `"SEND_WHILE_DISCONNECTED"` \| `"QUEUE_FULL"` \| `"QUEUE_BYTES_EXCEEDED"` \| `"BACKPRESSURE"` \| `"MESSAGE_TOO_LARGE"` \| `"RESOURCE_LIMIT_EXCEEDED"` \| `"ENCODE_FAILED"` \| `"DECODE_FAILED"` \| `"PROTOCOL_ERROR"` \| `"CAPABILITY_UNSUPPORTED"` \| `"INBOUND_OVERFLOW"` \| `"INTERNAL_STATE_ERROR"`

##### message

`string`

##### options?

`WwsErrorOptions` = `{}`

#### Returns

`WwsError`

#### Overrides

`Error.constructor`

## Properties

### name

> `readonly` **name**: `"WwsError"`

Defined in: [core/src/shared/errors.ts:62](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L62)

#### Overrides

`Error.name`

***

### code

> `readonly` **code**: `"INVALID_OPTIONS"` \| `"ENVIRONMENT_UNSUPPORTED"` \| `"CLIENT_DISPOSED"` \| `"CLIENT_DISCONNECTED"` \| `"ABORTED"` \| `"WORKER_UNSUPPORTED"` \| `"WORKER_CONSTRUCTION_FAILED"` \| `"WORKER_LOAD_FAILED"` \| `"WORKER_INIT_TIMEOUT"` \| `"WORKER_DISCONNECTED"` \| `"PROTOCOL_VERSION_MISMATCH"` \| `"ADAPTER_NOT_REGISTERED"` \| `"INVALID_CONTROL_MESSAGE"` \| `"CONNECTION_CONFIG_CONFLICT"` \| `"CONNECTION_TIMEOUT"` \| `"SOCKET_ERROR"` \| `"CLOSE_NOT_RETRYABLE"` \| `"RETRY_EXHAUSTED"` \| `"HEARTBEAT_TIMEOUT"` \| `"AUTH_FAILED"` \| `"STALE_REVISION"` \| `"SEND_WHILE_DISCONNECTED"` \| `"QUEUE_FULL"` \| `"QUEUE_BYTES_EXCEEDED"` \| `"BACKPRESSURE"` \| `"MESSAGE_TOO_LARGE"` \| `"RESOURCE_LIMIT_EXCEEDED"` \| `"ENCODE_FAILED"` \| `"DECODE_FAILED"` \| `"PROTOCOL_ERROR"` \| `"CAPABILITY_UNSUPPORTED"` \| `"INBOUND_OVERFLOW"` \| `"INTERNAL_STATE_ERROR"`

Defined in: [core/src/shared/errors.ts:63](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L63)

***

### retryable

> `readonly` **retryable**: `boolean`

Defined in: [core/src/shared/errors.ts:64](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L64)

***

### fatal

> `readonly` **fatal**: `boolean`

Defined in: [core/src/shared/errors.ts:65](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L65)

***

### details

> `readonly` **details**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [core/src/shared/errors.ts:66](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L66)

***

### cause

> `readonly` **cause**: `unknown`

Defined in: [core/src/shared/errors.ts:67](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/shared/errors.ts#L67)

#### Overrides

`Error.cause`
