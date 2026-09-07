# 事件与 client

`createWebSocket` 返回稳定实例。`open()` 建立一次端口参与期，`close()` 立即停止本地派发并有界等待 detach；再次 open 创建新 session。`dispose()` 永久释放注册、监听和参与需求。Promise 方法通过 rejection 报错；同步配置和注册 API 可同步抛错。

并发 open 有各自的 AbortSignal waiter，取消一个不关闭共享 socket，也不取消其他等待者。open 只等待本次尝试结果，不能把它当作无限自动重试直到成功的 Promise。后加入已 open 连接的页面也会收到 open 通知。

## 业务回调与单接收者分派

```ts
ws.onMessage(event => render(event.data))
const remove = ws.onMessage((event, { signal }) => {
  if (!signal.aborted)
    showNotification(event.data)
}, { dispatchKey: 'notification' })
ws.addEventListener('dispatchownerchange', () => updateBadge(ws.isDispatchOwner('notification')))
```

同一连接按 visible 优先、同级 FIFO 选择每个 key 的接收者，后注册不抢占。每物理帧固定 session/epoch/grant 代际，页面校验本地 lease 后才调用对应 handler；同页同 key 的所有注册独立执行。普通 handler 仍各页执行，`data` 只在实际派发业务值时更新。

这只约束分派资格。冻结页面可能恢复运行已开始的任务；signal 只能协作取消，`isDispatchOwner()` 只是最近确认的本地资格，不能作为跨页面副作用互斥锁。需要收到标志等一次连接协议效果，使用 [Worker 扩展](../guide/worker-extensions)。

keyed handler 不接收 replay，普通 handler 可以接收并自行判断 `event.replayed`。撤销资格、结束参与或 dispose 会取消相应 signal。handler 抛错、返回 rejected Promise、logger/事件观察者失败都被隔离；库不等待业务完成。重复注册同一函数是独立注册，移除函数幂等；EventTarget 保持 once/capture/signal 语义。

## 其他事件和操作

事件有 `message`、`dispatchownerchange`、`statechange`、`open`、`close`、`error`、`overflow`、`diagnostic`。动态 onMessage 先于 EventTarget message 监听器执行。

`onBeforeReconnect` 替换本页唯一准备 hook，新注册会取消旧事务；Worker 扩展提供准备时本页不参与。`reconnect({ countAsRetry })` 在请求接纳或合并后完成，不等待新 socket open。预算与冲突见 [可靠性](../guide/reliability)。

`diagnostics()` 同步返回最近收到的安全样本并合并后台刷新；两种 transport 都如此，`observedAt` 表示样本接收时间。
