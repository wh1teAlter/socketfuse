# 函数: createSharedWebSocketRuntime()

> **createSharedWebSocketRuntime**(`options?`): [`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

定义于: [core/src/worker/runtime.ts:230](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/worker/runtime.ts#L230)

创建不安装全局 onconnect 的 Worker-side runtime。

## 参数

### options?

[`SharedWebSocketRuntimeOptions`](../interfaces/SharedWebSocketRuntimeOptions.md) = `{}`

Worker 内静态 adapter、socket 工厂、时钟和资源上限；创建后资源上限
不能通过页面控制消息放宽。

## 返回

[`SharedWebSocketRuntime`](../interfaces/SharedWebSocketRuntime.md)

可手动连接 port、查询 instanceId 并最终 dispose 的 runtime。

## 抛出

`WwsError`，当静态 adapter 或 Worker 资源上限无效时。
