# Function: exposeSharedWebSocketWorker()

> **exposeSharedWebSocketWorker**(`options?`, `scope?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker/runtime.ts:551](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L551)

Create a runtime and install its port handler on the SharedWorker global scope.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

### scope?

[`SharedWorkerGlobalLike`](../interfaces/SharedWorkerGlobalLike.md)

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
