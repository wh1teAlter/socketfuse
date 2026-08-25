# 连接共享

## `id` 是共享标识

只有在同源、连接到同一份 SharedWorker 脚本，并且使用相同 `id` 与共享配置时，多个标签页
才会共享一个物理 socket。应将 `id` 视为应用命名空间，例如
`notifications:${tenantId}:${userId}`；它不是授权边界。

## 共享配置冲突

第一个客户端确定共享配置。另一个使用相同 `id` 的客户端必须在 endpoint、WebSocket 子协议、
协议适配器、重连/心跳/队列/背压/租约/限制和空闲宽限设置上保持一致。若不一致，会以
`CONNECTION_CONFIG_CONFLICT` 拒绝；需要独立连接时请使用不同的 `id`。

下列设置属于页面本地，不会导致冲突：`onMessage`、其他回调、`logger`、生命周期恢复/回放
选项、`immediate`、`fallback`、`autoClose` 以及 Worker 构造方式。

## 认证与 URL 变更使用 revision

更新共享 endpoint 或认证值时，必须通过单调递增的 revision 明确排序。较新的值会生效，
必要时触发重连；过期更新会被安全忽略。

```ts
await ws.updateAuth({ token: freshToken }, { revision: 4 })
await ws.updateUrl('wss://api.example.com/events-v2', { revision: 5 })
await ws.clearAuth({ revision: 6 })
```

每个调用方都应在应用内协调 revision 的所有权。认证 payload 不会通过诊断信息暴露。
