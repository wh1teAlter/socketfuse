# Function: createSharedWebSocketRuntime()

> **createSharedWebSocketRuntime**(`options?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker-runtime.ts:172](https://github.com/wh1teAlter/wws/blob/d8329db0e508c9b14b515c2bb718c128ea4754e4/packages/core/src/worker-runtime.ts#L172)

Create a Worker-side runtime without installing a global `onconnect` hook.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
