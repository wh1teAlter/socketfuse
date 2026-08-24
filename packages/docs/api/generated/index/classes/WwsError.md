# Class: WwsError

Defined in: [core/src/errors.ts:54](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L54)

Error contract used by rejected operations and error callbacks.

Prefer `code` over matching `message`. Details are sanitized before errors
cross the Worker boundary or reach page callbacks.

## Extends

- `Error`

## Constructors

### Constructor

> **new WwsError**(`code`, `message`, `options?`): `WwsError`

Defined in: [core/src/errors.ts:62](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L62)

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

Defined in: [core/src/errors.ts:55](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L55)

#### Overrides

`Error.name`

***

### code

> `readonly` **code**: `"INVALID_OPTIONS"` \| `"ENVIRONMENT_UNSUPPORTED"` \| `"CLIENT_DISPOSED"` \| `"CLIENT_DISCONNECTED"` \| `"ABORTED"` \| `"WORKER_UNSUPPORTED"` \| `"WORKER_CONSTRUCTION_FAILED"` \| `"WORKER_LOAD_FAILED"` \| `"WORKER_INIT_TIMEOUT"` \| `"WORKER_DISCONNECTED"` \| `"PROTOCOL_VERSION_MISMATCH"` \| `"ADAPTER_NOT_REGISTERED"` \| `"INVALID_CONTROL_MESSAGE"` \| `"CONNECTION_CONFIG_CONFLICT"` \| `"CONNECTION_TIMEOUT"` \| `"SOCKET_ERROR"` \| `"CLOSE_NOT_RETRYABLE"` \| `"RETRY_EXHAUSTED"` \| `"HEARTBEAT_TIMEOUT"` \| `"AUTH_FAILED"` \| `"STALE_REVISION"` \| `"SEND_WHILE_DISCONNECTED"` \| `"QUEUE_FULL"` \| `"QUEUE_BYTES_EXCEEDED"` \| `"BACKPRESSURE"` \| `"MESSAGE_TOO_LARGE"` \| `"RESOURCE_LIMIT_EXCEEDED"` \| `"ENCODE_FAILED"` \| `"DECODE_FAILED"` \| `"PROTOCOL_ERROR"` \| `"CAPABILITY_UNSUPPORTED"` \| `"INBOUND_OVERFLOW"` \| `"INTERNAL_STATE_ERROR"`

Defined in: [core/src/errors.ts:56](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L56)

***

### retryable

> `readonly` **retryable**: `boolean`

Defined in: [core/src/errors.ts:57](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L57)

***

### fatal

> `readonly` **fatal**: `boolean`

Defined in: [core/src/errors.ts:58](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L58)

***

### details

> `readonly` **details**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

Defined in: [core/src/errors.ts:59](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L59)

***

### cause

> `readonly` **cause**: `unknown`

Defined in: [core/src/errors.ts:60](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/errors.ts#L60)

#### Overrides

`Error.cause`
