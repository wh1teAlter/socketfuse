# Worker 共享处理

自定义心跳、收到消息后回传标志、协议过滤和连接状态属于物理连接。通过自定义 Worker 注册连接扩展，这些处理每物理帧执行一次；页面只注册需要响应的业务回调。

应用的收到标志由业务自行定义，不表示页面业务处理成功。库不提供 request/response 服务、消息关联表、可靠投递或 exactly-once。

## 按连接注册协议

以下协议收到服务器业务消息后回传一个标志，再向页面投影业务值；协议确认帧不会进入页面。

```ts
// worker.ts
import type { ProtocolAdapter } from 'socketfuse/protocol'
import { defineWorkerProtocol, exposeSharedWebSocketWorker } from 'socketfuse/worker'

type Wire = { kind: 'message' | 'received', id: string, body?: string }

const adapter: ProtocolAdapter<Wire, Wire> = {
  id: 'receipt-demo',
  version: 1,
  encode: value => JSON.stringify(value),
  decode: value => JSON.parse(String(value)) as Wire,
  classify: data => ({ type: data.kind === 'received' ? 'control' : 'data', data }),
}

const protocol = defineWorkerProtocol({
  adapter,
  createExtension: () => ({
    onFrame: frame => frame.type === 'control'
      ? { delivery: { type: 'consume' } }
      : {
          delivery: { type: 'broadcast', data: frame.data.body },
          reply: { kind: 'received', id: frame.data.id },
        },
  }),
})

exposeSharedWebSocketWorker({ protocols: [protocol] })
```

生产协议应在 `decode`/`classify` 中校验业务字段，不能仅依赖上例的 TypeScript 断言。`defineWorkerProtocol` 在注册位置关联解码、出站和页面投影类型，支持异构注册表；相同 id/version 重复注册立即失败。

页面只传协议描述符，不传函数：

```ts
const ws = createWebSocket<string | undefined, Wire>(url, {
  id: 'feed',
  protocol: { type: 'custom', id: 'receipt-demo', version: 1 },
  worker: () => new SharedWorker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
})
ws.onMessage(event => render(event.data))
```

raw/JSON 连接也可用 `createSharedWebSocketRuntime({ createExtension })` 注册通用扩展。自定义协议的扩展在自己的 `defineWorkerProtocol` 注册项中配置，避免和另一 adapter 错配。自定义 Worker 初始化失败会报错，不能降级后丢失其协议逻辑。

## 一帧的执行顺序

引擎同步 decode/classify，消费 ping/pong；其余 data/control 进入一次 `onFrame`。返回值只允许 `delivery`、可选 `reply` 和可选 `reconnect`。

1. 先验证整个结果并取得业务投影快照。
2. `reply` 在当前 open socket 上发送一次，受编码大小与背压约束，不入队、不跨重连补发。
3. `broadcast` 将投影分别投递给页面；`consume` 不投递。单页额度不足只影响该页。
4. 可选 `reconnect: { countAsRetry: false }` 请求一次不计数重连；省略该字段则计数。每一步都重新检查尝试是否仍有效。

未提供 `onFrame` 时，data 默认广播，control 默认消费。普通抛错会报告安全错误并消费当前帧；不回退广播原始协议内容。同步 hook 返回 Promise/thenable 属于终止性 `PROTOCOL_CONTRACT_VIOLATION`，该条目不能恢复。页面业务 Promise 从不返回给 Worker 等待。

回放只保存最终业务投影，不重跑 `onFrame`、回复或重连。Worker 重启会丢失内存状态，网络和页面都可能漏收或重复；这是尽力投递，不能据此宣称 at-least-once。

## 连接状态和心跳

`createExtension` 每条连接实例化一次；`onSocketOpen` 在页面 open 通知前初始化本次尝试状态，`onSocketClose` 每次尝试结束调用一次，`dispose` 在条目回收时释放应用资源。上下文只包含连接 id、epoch、attempt 与当前 endpoint origin。

扩展可提供 `createPing`/`createPong`，读取闭包内的连接状态。存在扩展心跳生成组时整组替代 adapter 生成组，启用 heartbeat 时该组必须有 `createPing`。引擎仍唯一拥有 interval、pongTimeout、单待决检测与超时重连；不要另启一套定时器。声明式 JSON 模板适合静态 ping，adapter 适合无状态 wire 转换。

## 有界重连准备

`prepareAttempt` 是唯一允许异步的扩展 hook，用于刷新 endpoint 或延迟。首次物理尝试不调用它；后续自动、显式和恢复需求统一进入计划。

```ts
exposeSharedWebSocketWorker({
  createExtension: () => ({
    prepareAttempt: async (context) => {
      const url = await buildFreshEndpoint(context.signal)
      context.setOptions({ url })
      context.setDelay(0)
    },
  }),
})
```

提供该方法即独占准备权，忙、超时或失败都采用默认计划，不转交页面。未提供时从健康页面的 `onBeforeReconnect` 候选中选一个。最后参与需求撤销会取消计划；它不能在完全无需求时维持后台连接。

`reconnect.hookTimeout` 是整个计划的总期限，候选交接不重新计时。URL/delay 全部验证后原子提交。取消、成功或期限结束立即撤销 setter 并 abort signal；迟到 setter 报 `STALE_RECONNECT_PLAN`。每来源最多一个未 settle 调用、每 realm 最多 16 个；取消不能强制终止应用 Promise，也不提前归还其容量。
