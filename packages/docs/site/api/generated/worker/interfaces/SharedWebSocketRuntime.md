# 接口: SharedWebSocketRuntime

定义于: [core/src/worker/runtime.ts:96](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/worker/runtime.ts#L96)

SharedWorker 端 runtime：接受页面 port 并拥有共享物理连接。

## 属性

### instanceId

> `readonly` **instanceId**: `string`

定义于: [core/src/worker/runtime.ts:98](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/worker/runtime.ts#L98)

Worker 实例 id，仅用于安全诊断关联。

***

### connect

> **connect**: (`port`) => `void`

定义于: [core/src/worker/runtime.ts:100](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/worker/runtime.ts#L100)

接受一个新页面 port；失败时关闭端口。

#### 参数

##### port

[`MessagePortLike`](MessagePortLike.md)

#### 返回

`void`

***

### dispose

> **dispose**: () => `void`

定义于: [core/src/worker/runtime.ts:102](https://github.com/wh1teAlter/wws/blob/0f8b805b4ef7a28fc7d89804a150e375c03ab260/packages/core/src/worker/runtime.ts#L102)

停止 lease、关闭端口并销毁所有 controller。

#### 返回

`void`
