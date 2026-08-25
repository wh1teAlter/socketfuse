# 事件与客户端

`createWebSocket()` 返回的是 `WebSocketClient`，而不是 Promise 或全局单例。它的属性是本地页面
代理的快照；共享连接的观测数据请使用 `diagnostics()` 获取。

## 动态消息

`onMessage(handler)` 可在创建后或打开后调用。它返回取消订阅函数，并支持多个相互独立的处理器。
抛出异常的处理器会被隔离，并通过错误路径报告。

```ts
const off = ws.onMessage(event => render(event.data))
off()
```

实例也会派发 `message`、`statechange`、`open`、`close`、`error`、`overflow` 与 `diagnostic`
事件，供 `addEventListener` 用户使用。

## 有意保留的 v1 边界

由于动态 `onMessage()` 是唯一的消息监听器抽象，因此没有 `subscribe()` 方法。也没有
`request()` 辅助方法、关联表、服务端 Ack 或投递保证。需要请求/响应或可靠投递时，请在应用协议
中建模。
