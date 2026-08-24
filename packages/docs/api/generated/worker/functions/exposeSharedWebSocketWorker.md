# Function: exposeSharedWebSocketWorker()

> **exposeSharedWebSocketWorker**(`options?`, `scope?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker-runtime.ts:551](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L551)

Create a runtime and install its port handler on the SharedWorker global scope.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

### scope?

[`SharedWorkerGlobalLike`](../interfaces/SharedWorkerGlobalLike.md)

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
