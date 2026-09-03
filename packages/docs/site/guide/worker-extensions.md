# Worker 共享处理

有些逻辑属于整条共享连接，而不属于某个标签页：入站去重、一份共享的服务端时钟、重连前刷新
凭据。把它们写在页面里，每个标签页都会各做一遍，结果还无法互相共享。

**连接作用域扩展**让这些逻辑在 SharedWorker 内按连接运行一次。它需要自定义 Worker 部署；
页面声明式配置仍是默认路径，不使用扩展时行为完全不变。

## 选择：Worker 扩展还是 execution key

两者解决不同的问题，最容易误用的就是这一点。

| 需求 | 用什么 | 原因 |
| --- | --- | --- |
| 入站去重、过滤、维护共享服务端时钟 | **Worker 扩展** | 一次生效、无交接、无竞态；被丢弃的帧不消耗任何页面的投递额度 |
| 只弹一次通知、只写一次本地存储、只跳转一次路由 | **execution key** | Worker 里没有 DOM，扩展无法完成页面副作用 |

判断方法：这段逻辑**需要访问页面**吗？需要就用 key，不需要就放进扩展。

## 入站过滤

`filterInbound` 判定一条已解码业务帧是否派发给标签页。判定在 fan-out 之前发生，因此
`drop` 的帧既不穿过 `MessagePort`，也不消耗任何标签页的投递额度。

```ts
// worker.ts
import { exposeSharedWebSocketWorker } from 'socketfuse/worker'

exposeSharedWebSocketWorker({
  createExtension: () => {
    // 每条共享连接一个实例，状态天然按连接隔离。
    const seen = new Set<string>()
    return {
      onSocketOpen: () => seen.clear(), // 重连后重建连接期状态
      filterInbound: (data) => {
        const id = (data as { id?: string }).id
        if (id === undefined)
          return 'deliver'
        if (seen.has(id))
          return 'drop'
        seen.add(id)
        return 'deliver'
      },
    }
  },
})
```

`filterInbound` **必须同步**：Worker 是全部标签页共享的单线程，`await` 会直接放大为所有
标签页的延迟。抛出异常时该帧按 `deliver` 放行——静默丢弃全局消息比重复投递严重得多。

::: warning 这不是 exactly-once
浏览器可以在内存压力下整体回收 SharedWorker，去重表随之丢失，重启后旧消息可能再次放行。
语义是 at-least-once。真正的幂等仍需应用在自己的事务边界内保证。
:::

## 重连前准备连接尝试

`prepareAttempt` 在下一次物理连接尝试前运行，可以异步刷新 endpoint 与延迟，**不依赖任何
页面处于活跃状态**，因此不受页面冻结、回收或提交过期影响，恢复时间也不随标签页数量放大。

```ts
exposeSharedWebSocketWorker({
  createExtension: () => ({
    prepareAttempt: async (context) => {
      const token = await refreshToken() // 业务自己的异步逻辑
      context.setOptions({ url: `wss://api.example.com/rt?token=${token}` })
      context.setDelay(0)
    },
  }),
})
```

提供该方法即由扩展接管：页面 `onBeforeReconnect` 不再参与该连接的计划，避免出现两个提交源。
未提供时完全回退到页面候选机制，内联 Worker 的零配置路径不受影响。

准备受 `autoReconnect.hookTimeout` 约束（整个计划的总期限，不因候选转移重新计时）。超时或
抛出时沿用当前 endpoint 与默认退避；期限过后调用 setter 会以 `STALE_RECONNECT_PLAN` 拒绝。

**只能改 endpoint 与 delay。** `heartbeat`、`queue`、`limits` 等共享参数参与配置指纹，是多
标签页的启动期共识；运行时单方面修改会让「相同 `id` 必须相同共享配置」失效。

## 动态 ping

需要每次 ping 实时生成 payload（例如携带当前服务端时间戳）时，用 custom adapter 的
`createPing`——它每个心跳周期调用一次：

```ts
const adapter = {
  id: 'my-proto',
  version: 1,
  encode: (data: unknown) => JSON.stringify(data),
  decode: (data: unknown) => JSON.parse(String(data)),
  classify: (data: any) => data?.messageType === 'pong' ? { type: 'pong' } : { type: 'data', data },
  createPing: () => ({ messageType: 'ping', ts: Date.now() }),
}
```

声明式 JSON 的 `heartbeat.ping` 是**静态值**，无法逐次生成——JSON 配置之所以能在内联 Worker
中使用，正因为它是纯可序列化数据。所以这两条路径互斥：

- 需要零部署 → 用 JSON 声明式配置，ping 为静态值
- 需要动态 ping → 用 custom adapter，必须自定义 Worker

心跳的**时序**始终由配置拥有（`interval`、`mode`、`pongTimeout`），与 adapter 无关。未配置
`pongTimeout` 时只发保活消息，库不会自行触发超时重连。
