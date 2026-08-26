# 类: WwsError

定义于: [core/src/shared/errors.ts:78](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L78)

异步操作 reject 与 error callback 使用的错误契约。

调用方必须依据 `code` 而不是匹配 `message`。details 和 cause 在错误跨 Worker
边界或进入页面 callback 前会被移除，维持“不泄露凭据与内部异常”的不变量。

## 继承

- `Error`

## 构造函数

### 构造函数

> **new WwsError**(`code`, `message`, `options?`): `WwsError`

定义于: [core/src/shared/errors.ts:99](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L99)

创建本地错误对象。

#### 参数

##### code

`"INVALID_OPTIONS"` \| `"ENVIRONMENT_UNSUPPORTED"` \| `"CLIENT_DISPOSED"` \| `"CLIENT_DISCONNECTED"` \| `"ABORTED"` \| `"WORKER_UNSUPPORTED"` \| `"WORKER_CONSTRUCTION_FAILED"` \| `"WORKER_LOAD_FAILED"` \| `"WORKER_INIT_TIMEOUT"` \| `"WORKER_DISCONNECTED"` \| `"PROTOCOL_VERSION_MISMATCH"` \| `"ADAPTER_NOT_REGISTERED"` \| `"INVALID_CONTROL_MESSAGE"` \| `"CONNECTION_CONFIG_CONFLICT"` \| `"CONNECTION_TIMEOUT"` \| `"SOCKET_ERROR"` \| `"CLOSE_NOT_RETRYABLE"` \| `"RETRY_EXHAUSTED"` \| `"HEARTBEAT_TIMEOUT"` \| `"AUTH_FAILED"` \| `"STALE_REVISION"` \| `"SEND_WHILE_DISCONNECTED"` \| `"QUEUE_FULL"` \| `"QUEUE_BYTES_EXCEEDED"` \| `"BACKPRESSURE"` \| `"MESSAGE_TOO_LARGE"` \| `"RESOURCE_LIMIT_EXCEEDED"` \| `"ENCODE_FAILED"` \| `"DECODE_FAILED"` \| `"PROTOCOL_ERROR"` \| `"CAPABILITY_UNSUPPORTED"` \| `"INBOUND_OVERFLOW"` \| `"INTERNAL_STATE_ERROR"`

供调用方分支处理的稳定错误码。

##### message

`string`

当前 realm 中可读的错误文本。

##### options?

`WwsErrorOptions` = `{}`

重试、终态和本地诊断元数据。

#### 返回

`WwsError`

#### 重写了

`Error.constructor`

## 属性

### name

> `readonly` **name**: `"WwsError"`

定义于: [core/src/shared/errors.ts:80](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L80)

便于跨 realm 判断的稳定错误名称。

#### 重写了

`Error.name`

***

### code

> `readonly` **code**: `"INVALID_OPTIONS"` \| `"ENVIRONMENT_UNSUPPORTED"` \| `"CLIENT_DISPOSED"` \| `"CLIENT_DISCONNECTED"` \| `"ABORTED"` \| `"WORKER_UNSUPPORTED"` \| `"WORKER_CONSTRUCTION_FAILED"` \| `"WORKER_LOAD_FAILED"` \| `"WORKER_INIT_TIMEOUT"` \| `"WORKER_DISCONNECTED"` \| `"PROTOCOL_VERSION_MISMATCH"` \| `"ADAPTER_NOT_REGISTERED"` \| `"INVALID_CONTROL_MESSAGE"` \| `"CONNECTION_CONFIG_CONFLICT"` \| `"CONNECTION_TIMEOUT"` \| `"SOCKET_ERROR"` \| `"CLOSE_NOT_RETRYABLE"` \| `"RETRY_EXHAUSTED"` \| `"HEARTBEAT_TIMEOUT"` \| `"AUTH_FAILED"` \| `"STALE_REVISION"` \| `"SEND_WHILE_DISCONNECTED"` \| `"QUEUE_FULL"` \| `"QUEUE_BYTES_EXCEEDED"` \| `"BACKPRESSURE"` \| `"MESSAGE_TOO_LARGE"` \| `"RESOURCE_LIMIT_EXCEEDED"` \| `"ENCODE_FAILED"` \| `"DECODE_FAILED"` \| `"PROTOCOL_ERROR"` \| `"CAPABILITY_UNSUPPORTED"` \| `"INBOUND_OVERFLOW"` \| `"INTERNAL_STATE_ERROR"`

定义于: [core/src/shared/errors.ts:82](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L82)

面向调用方的稳定错误码。

***

### retryable

> `readonly` **retryable**: `boolean`

定义于: [core/src/shared/errors.ts:84](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L84)

是否允许当前操作自动或手动重试。

***

### fatal

> `readonly` **fatal**: `boolean`

定义于: [core/src/shared/errors.ts:86](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L86)

是否表示 client 不应再尝试恢复。

***

### details

> `readonly` **details**: `Readonly`\<`Record`\<`string`, `unknown`\>\> \| `undefined`

定义于: [core/src/shared/errors.ts:88](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L88)

本地可选的已脱敏诊断详情。

***

### cause

> `readonly` **cause**: `unknown`

定义于: [core/src/shared/errors.ts:90](https://github.com/wh1teAlter/wws/blob/7b6bd31a5ba45c5afbdf281cb7fb2bfbf1a2c549/packages/core/src/shared/errors.ts#L90)

本地原始异常原因；不得序列化到控制协议。

#### 重写了

`Error.cause`
