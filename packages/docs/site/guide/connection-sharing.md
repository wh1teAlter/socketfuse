# 连接共享

## `id` 是共享标识

只有在同源、连接到同一份 SharedWorker 脚本，并且使用相同 `id` 与共享配置时，多个标签页
才会共享一个物理 socket。应将 `id` 视为应用命名空间，例如
`notifications:${tenantId}:${userId}`；它不是授权边界。

## 共享配置冲突

第一个客户端确定共享配置和当前连接尝试的 URL。完整 endpoint 不属于共享配置：另一个使用相同
`id` 的客户端可以传入不同 URL，但该 URL 不会覆盖存量连接。WebSocket 子协议、协议适配器、
重连/心跳/队列/背压/租约/限制和空闲宽限设置必须一致；若不一致，会以
`CONNECTION_CONFIG_CONFLICT` 拒绝；需要独立连接时请使用不同的 `id`。

下列设置属于页面本地，不会导致冲突：`onMessage`、其他回调、`logger`、生命周期恢复/回放
选项、`immediate`、`fallback`、`autoClose` 以及 Worker 构造方式。

## 应用状态留在应用，URL 使用重连计划

初始化 URL 只接受固定字符串，库不接收 getter、模板或连接变量；动态 URL 由业务在被选中的
重连 hook 中重新生成。credential、session、业务 ready、Ack、cursor 与幂等由应用协议维护。

```ts
ws.onBeforeReconnect(async (context) => {
  context.setOptions({ url: await buildFreshEndpoint() })
  context.setDelay(0)
})
```

一次重连计划只接受 Worker 选中页面的原子提交；URL query 与应用 payload 不会通过诊断、logger
或控制响应暴露。应用如需在 open 后认证，应使用普通 `sendMessage()` 并自行维护业务就绪状态。

## handler execution key

相同 key 的后注册页面不会抢占当前 holder。需要交接时，Worker 优先 visible 页面，并在相同
可见性内按注册 FIFO 选择；hidden 不主动交接，freeze、close、端口失败与 lease 失效会交接。
这不是授权机制或跨设备分布式锁。
