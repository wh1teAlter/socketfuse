# Function: createSharedWebSocketRuntime()

> **createSharedWebSocketRuntime**(`options?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker-runtime.ts:147](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L147)

Create a Worker-side runtime without installing a global `onconnect` hook.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
