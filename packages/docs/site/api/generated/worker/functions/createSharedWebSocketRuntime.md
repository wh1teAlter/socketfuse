# Function: createSharedWebSocketRuntime()

> **createSharedWebSocketRuntime**(`options?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

Defined in: [core/src/worker/runtime.ts:172](https://github.com/wh1teAlter/wws/blob/ebad801c00f7d9b7e43a22c375cc094a8f3f6cc5/packages/core/src/worker/runtime.ts#L172)

Create a Worker-side runtime without installing a global `onconnect` hook.

## Parameters

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

## Returns

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)
