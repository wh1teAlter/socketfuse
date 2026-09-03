# 事件与客户端

`createWebSocket()` 返回的是 `WebSocketClient`，而不是 Promise 或全局单例。它的属性是本地页面
代理的快照；共享连接的观测数据请使用 `diagnostics()` 获取。

## 动态消息

`onMessage(handler, options?)` 可在创建后或打开后调用。它返回取消订阅函数，并支持多个相互独立的处理器。
抛出异常的处理器会被隔离，并通过错误路径报告。

```ts
const off = ws.onMessage(event => render(event.data))
off()
```

传入 `{ key }` 时，同一共享连接只有 holder 页面调用该 key 的所有本地 handler；业务消息本身、
普通 handler 和 EventTarget `message` 仍广播到全部页面。handler 的第二个参数提供 signal，revoke
会 abort 旧 grant 的 signal：

```ts
const off = ws.onMessage(async (event, { signal }) => {
  await applySingleWriterEffect(event.data, { signal })
}, { key: 'single-writer' })

ws.addEventListener('keychange', () => updateBadge(ws.holdsKey('single-writer')))
```

库无法强制停止已经开始的 Promise；异步 handler 应在副作用边界检查 signal。direct fallback
中每个页面 client 都持有自己的 key，不提供跨标签页独占。

## 重连 hook

`onBeforeReconnect(handler)` 每个逻辑 client 至多保留一个当前 handler，并返回取消函数。context
只允许 `setOptions({ url })`、`setDelay(ms)`，以及读取 `attempt`、`defaultDelay`、`reason`、安全
`close` 与 `signal`。hook 成功返回后才原子提交；断线、连接/心跳超时与显式 `reconnect()` 都会调用，
首次 `open()` 和正常关闭不会调用。`hookTimeout` 是整个 plan 的总期限，不会按候选重新开始。

实例也会派发 `message`、`keychange`、`statechange`、`open`、`close`、`error`、`overflow` 与 `diagnostic`
事件，供 `addEventListener` 用户使用。

## 有意保留的 v1 边界

由于动态 `onMessage()` 是唯一的消息监听器抽象，因此没有 `subscribe()` 方法。也没有
`request()` 辅助方法、关联表、服务端 Ack、入站 dedupe、exactly-once 或投递保证。需要请求/响应、
幂等或可靠投递时，请在应用协议中建模。
