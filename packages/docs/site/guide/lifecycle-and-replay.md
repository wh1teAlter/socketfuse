# 生命周期与回放

浏览器页面可能隐藏、冻结、从后退/前进缓存恢复或终止。SocketFuse 可以为前三种状态协调尽力而为的
本地暂停与回放缓冲区。

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  lifecycle: {
    restore: { replay: true, maxMessages: 256, maxBytes: 4 * 1024 * 1024 },
  },
})
```

## 工作方式

SocketFuse 始终观察 visibility 与 freeze/resume，以便 Worker 转移 dispatch key 和重连计划；
启用 restore 后还会把这些信号用于消息暂停与回放。
启用 restore 时，BFCache 的 `pagehide` 暂停当前页面。restore 关闭时，以及普通 `pagehide`，会自动分离，除非设置
`autoClose: false`。暂停期间，direct 和 SharedWorker transport 都不会派发实时消息。启用回放后，
消息只在 runtime 的每参与期唯一缓冲中保留，随后按 FIFO 顺序通过普通 `onMessage` 监听器派发，keyed handler 不接收回放，并带有
`event.replayed === true`。

Worker 只派发事件，绝不等待页面处理器。页面业务 Promise 不占用 runtime 等待表；direct 的页面主线程仍受浏览器自身调度影响。

## 边界

回放默认关闭且受上限约束。超大新帧只丢自己；其他溢出时，最早缓存的条目会被丢弃，并派发 `overflow` 事件。
恢复时，SocketFuse 会探测已选 SharedWorker；若 Worker 已消失，只重建该共享 transport，并重新应用
dispatch key、hook 注册与连接需求。Worker 重启、错过租约、页面终止和服务端重连都不是可靠的消息恢复
边界。消息不得丢失时，请在应用协议中使用游标或持久化投递。
