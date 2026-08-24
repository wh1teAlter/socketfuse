# Function: exposeSharedWebSocketWorker()

> **exposeSharedWebSocketWorker**(`options?`, `scope?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker-runtime.ts:441](https://github.com/wh1teAlter/wws/blob/67c6cef834b648e5ab5037d8b8c8080a6a904d54/packages/core/src/worker-runtime.ts#L441)

Create a runtime and install its port handler on the SharedWorker global scope.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

### scope?

[`SharedWorkerGlobalLike`](../interfaces/SharedWorkerGlobalLike.md)

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
