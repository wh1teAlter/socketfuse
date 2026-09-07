# 可靠性

## 一个共享重连预算

```ts
const ws = createWebSocket(url, {
  id: 'feed',
  reconnect: {
    automatic: true,
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30_000,
    factor: 2,
    jitter: 0.2,
    stableThreshold: 30_000,
    hookTimeout: 10_000,
  },
})
```

在上面 `maxRetries: 3` 的配置中，首次物理尝试不计数。断线自动恢复、页面 `reconnect()`、Worker 帧请求及同一 epoch 内的需求恢复共享最多三次预算。接纳计划先预留，真正调用 socket 工厂才扣数，构造失败也扣一次；取消未启动计划只释放预留。

`reconnect({ countAsRetry: false })` 不占本次预算，也不清零已用次数。Worker 可在 `onFrame` 返回同样的策略。不计数尝试失败后的自动恢复仍是新的计数计划。

同一计划、同一计数策略的请求合并，不重复准备或扣数；策略冲突报 `RECONNECT_IN_PROGRESS`，旧 epoch/attempt 请求报 `STALE_RECONNECT_PLAN`。预算耗尽报 `RETRY_EXHAUSTED`，不会为了失败的请求关闭健康 socket。关闭后在 idle 宽限内重新 open 不重置连接 epoch 的预算。

`automatic: false` 只关闭引擎自动触发，显式请求仍可使用预算。正常关闭码 1000 默认不自动重连，但可显式恢复；adapter 的同步 `shouldReconnect` 可覆盖自动许可。协议终止或异步转换违约是 failed 终态，不能用不计数请求绕过。

只有当前 socket 连续 open 达到 `stableThreshold` 才重置计数；设置 `false` 可禁用自动重置。准备、关闭及退避时间不累计。延迟在抖动后仍夹紧到 maxDelay 并取整数。socket 原生关闭尚未确认时不会构造第二条连接。

## 发送与背压

先调用 `open()` 表达参与需求，再调用 `sendMessage()`。取消 open 的一个等待者不会撤销这份需求。

```ts
const opening = ws.open()
const receipt = await ws.sendMessage(payload, { queue: true })
await opening
// receipt.status: accepted 或 queued，仅代表本地结果。
```

业务 FIFO 默认不离线缓存；可通过 `queue` 或本次 `{ queue: true }` 开启，始终受条数和字节限制。编码结果入队时取得自有快照；视图只保留实际 wire 字节。背压消退后同一 drain 继续 FIFO，不需要重连唤醒。离开的参与者尚未发送的数据会移除。

页面每参与期最多保留 64 个用户操作、4 MiB 克隆预算，包括 open waiter、未 post 发送与端口请求。短控制确认期限为 5 秒，与网络 open 等待分开。发送已 post 但失去确认时可能报 `SEND_OUTCOME_UNKNOWN`；库不自动重发，避免重复业务消息。

## 心跳

`heartbeat` 默认关闭。raw 的 `true` 按默认间隔发送 `ping` 并消费 `pong`。未配置 `pongTimeout` 时只保活，不主动判超时；配置后，`mode: 'pong'` 接受协议 pong，`mode: 'activity'` 接受有效入站活动。引擎始终只有一个心跳调度者。

浏览器原生 WebSocket Ping/Pong 由网络栈处理，JavaScript 不能直接发送或监听。应用协议的自定义回复和心跳生成见 [Worker 共享处理](./worker-extensions)。

## 投递与回放额度

两种 transport 都通过原生 MessagePort 使用同一 runtime，拥有相同克隆、错误、单帧和投递限制。direct 的共享范围仅限当前 JavaScript realm；shared 的范围是同一个 SharedWorker 实例。

每参与期默认最多 256 条未确认投递、4 MiB 完整 envelope 字节；计费包含资格元数据和 typed-array 完整 backing buffer。页面在业务 handler 之前归还 receipt，Worker 不等待业务 Promise。这不限制应用自行启动的异步任务数量。

额度不足只影响该页：实时帧丢 newest；暂停/恢复回放受独立条数和字节预算控制，超大新帧只丢自己，容得下的新帧才可淘汰 oldest。回放队首在 credit 恢复前保留，新的实时数据排在它后面。`overflow` 通知合并以防通知自身无限积压。

所有结果都是尽力投递；本地发送回执、端口 receipt、应用收到标志及业务事务成功分别表示不同事实。需要可靠性时由应用协议维护服务端持久化、游标和幂等。
