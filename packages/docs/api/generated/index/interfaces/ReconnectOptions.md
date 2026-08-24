# Interface: ReconnectOptions

Defined in: [core/src/types.ts:36](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L36)

Shared reconnect policy. Delays are expressed in milliseconds.

## Properties

### retries

> **retries**: `number`

Defined in: [core/src/types.ts:38](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L38)

Maximum retries, or `Infinity`. Defaults to `Infinity`.

***

### initialDelay

> **initialDelay**: `number`

Defined in: [core/src/types.ts:40](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L40)

Base retry delay. Defaults to `1000`.

***

### maxDelay

> **maxDelay**: `number`

Defined in: [core/src/types.ts:42](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L42)

Maximum retry delay. Defaults to `30000`.

***

### factor

> **factor**: `number`

Defined in: [core/src/types.ts:44](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L44)

Exponential multiplier. Defaults to `2`.

***

### jitter

> **jitter**: `number`

Defined in: [core/src/types.ts:46](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L46)

Random delay ratio from `0` to `1`. Defaults to `0.2`.

***

### stableThreshold

> **stableThreshold**: `number`

Defined in: [core/src/types.ts:48](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/types.ts#L48)

Open duration after which the retry counter resets. Defaults to `30000`.
