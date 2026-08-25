# 函数: exposeSharedWebSocketWorker()

> **exposeSharedWebSocketWorker**(`options?`, `scope?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

定义于: [core/src/worker/runtime.ts:629](https://github.com/wh1teAlter/wws/blob/cba440556efdd7dc7fded160f027961f41c71d24/packages/core/src/worker/runtime.ts#L629)

创建 runtime 并在 SharedWorker global scope 安装 onconnect。

## 参数

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

Worker runtime 依赖和静态资源上限。

### scope?

[`SharedWorkerGlobalLike`](../interfaces/SharedWorkerGlobalLike.md)

可选的测试/自定义 global scope；省略时使用当前 Worker globalThis。

## 返回

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

已安装连接入口的 runtime。

## 抛出

`WwsError`，当 runtime 选项无效时。
