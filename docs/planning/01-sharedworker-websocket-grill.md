# WWS SharedWorker WebSocket 方案调研与决策清单

状态：grill-with-docs / 已完成，推荐方案已进入 draft spec
调研日期：2026-08-19
目标仓库：wws

## 1. 目标重述

WWS 面向浏览器，把同源、同一浏览器存储分区中的多个页面连接到同一个 SharedWorker，并让该 Worker 按“连接身份”维护唯一物理 WebSocket。它的首要收益是减少服务端连接数；其次才是减少页面主线程中的协议解析与状态管理。

这里的“唯一”应定义为：

- 每个 SharedWorker 脚本实例中，每个连接 id 最多一个物理 WebSocket。
- 不同用户、租户、服务端点、子协议或不兼容协议版本不能错误复用。
- 同一个 Worker 可以维护多个连接 id，不能假设整个 origin 永远只有一个后端连接。
- 普通窗口与无痕窗口、不同浏览器 profile、跨 origin 页面不会共享。

## 2. 调研结论

### 2.1 平台事实

- SharedWorker 是标准 API，多个窗口或 iframe 只有在协议、主机、端口完全相同时才能访问同一个 Worker。
- 重复使用相同脚本 URL 和相同 Worker 身份会复用既有 Worker。脚本 URL 必须同源；CSP、Trusted Types 和正确的 JavaScript MIME 类型都会影响构造。
- SharedWorker 只在仍有窗口、iframe 或 Worker 引用它时保证存活。最后一个页面关闭后，不能把它当作后台常驻服务。
- extendedLifetime 在当前兼容数据中仍不是跨浏览器能力，不能成为核心正确性的依赖。
- WebSocket 可在 Worker 中使用，但浏览器 WebSocket API 不提供真正的接收背压，也不能设置任意握手 Header。
- WebSocket.send() 只表示把数据放入浏览器发送队列，不表示服务端已接收；服务端确认必须由应用协议提供。

截至调研日的 MDN Browser Compat Data 显示：

- 桌面 Chromium/Firefox 已长期支持 SharedWorker。
- Safari 与 iOS Safari 从 16 起重新支持。
- Firefox Android 从 33 起支持。
- Chrome Android 标记为从 148 起支持；更旧移动 Chromium 需要降级策略。
- module SharedWorker 的最低版本高于 classic SharedWorker。
- Safari 当前未实现 options.name，设计不能依赖 name 区分连接或版本。

### 2.2 生态现状

成熟 WebSocket 封装的共同能力包括：

- WebSocket 风格事件与 ready state。
- 连接超时、手动连接/关闭/重连。
- 指数退避、抖动、稳定窗口和最大重试次数。
- 断线发送队列。
- 应用层 ping/pong 心跳。
- 动态 URL 或 token 刷新。
- JSON 帮助方法和消息过滤。

但这些能力不处于同一抽象层：

- reconnecting-websocket 与 PartySocket 主要解决单连接重连、超时和发送缓冲。
- react-use-websocket 的 share 只在一个页面的 React 组件之间共享，不跨 tab。
- Socket.IO、Centrifuge、graphql-ws 的 namespace、channel、ack、恢复和 token 刷新依赖各自的服务端协议，不能由通用 raw WebSocket 客户端无条件模拟。
- 检索到的 SharedWorker WebSocket 专用项目很少，且采用量很低。已有项目通常绑定 JSON topic 格式、只允许第一个 tab 配置 Worker，或把 fallback 与主通道做成不同语义。

因此，WWS 的合理产品边界是“可靠的跨 tab 传输内核 + 可插拔 Worker 端协议适配器”，而不是内置一套假装兼容所有服务端的私有协议。

## 3. 推荐架构

### 3.1 运行时拓扑

    Tab A ─┐
    Tab B ─┼─ page client / MessagePort ─ SharedWorker
    Tab C ─┘                              ├─ pool[key A] ─ WebSocket A
                                         └─ pool[key B] ─ WebSocket B

页面端负责：

- 创建或复用 SharedWorker MessagePort。
- 暴露现代客户端 API、EventTarget 事件和 onMessage handler。
- 维护同一页面内的 client 生命周期与监听器。
- 页面恢复、版本握手、超时与 AbortSignal。
- 把 transport、状态、队列和诊断信息呈现给调用方。

Worker 端负责：

- 连接 id 到物理 WebSocket 的池化。
- 配置指纹冲突检测，拒绝“同 key 不同 URL/协议”的静默复用。
- 状态机、连接超时、退避重连、稳定窗口和应用层心跳。
- 有界发送队列、bufferedAmount 高水位和溢出策略。
- port 租约、异常关闭回收、最后一个 client 离开后的宽限关闭。
- raw 广播，或通过协议适配器做消息分类。
- 版本握手、脱敏诊断和稳定错误码。

### 3.2 两层协议

第一层是 WWS 自己的 page-to-worker 控制协议：

- hello / attach / detach
- configure / config-conflict
- open / close / reconnect
- send / accepted / queued / error
- auth-update
- status / message / diagnostics
- lease / probe / suspend / restore / recover

控制协议必须带 protocol major、operation id、client id、连接 id，并在运行时校验消息，不信任任意同源页面发来的数据。

第二层是用户与 WebSocket 服务端的业务协议：

- 内置 raw 模式：完整支持 string、Blob、ArrayBuffer 和 ArrayBufferView，入站默认广播。
- 内置 declarative JSON 模式：可按字段完成消息分类，不要求执行页面传来的函数。
- 自定义 adapter：在应用自己的 Worker 入口中注册 encode、decode、classify、heartbeat 和 auth 行为。

任意函数都不能通过 MessagePort 传给 Worker。自定义 adapter 必须在构建 Worker 时静态注册。

### 3.3 连接身份

建议要求调用方显式提供不含秘密的 id，例如：

    realtime:tenant-a:user-42

Worker 同时计算共享配置指纹，至少覆盖：

- 规范化后的 URL（诊断输出必须脱敏）
- WebSocket subprotocols
- adapter id 与 adapter protocol version
- binaryType
- 影响共享状态的 reconnect/heartbeat 关键参数

同一个 key 收到不同指纹时返回 CONNECTION_CONFIG_CONFLICT，不采用“第一个 tab 永远胜出”。

token 不进入 key、日志或持久化存储。动态鉴权使用带 revision 的内存更新；旧 revision 不能覆盖新 revision。浏览器 WebSocket 无法设置 Authorization 等自定义握手 Header，鉴权只能通过 cookie、URL、subprotocol 或 adapter 定义的首帧完成。

SharedWorker 也不是同源内部的安全边界：能够在同源执行脚本的页面原则上可以连接它。Worker name、连接 id 和控制协议校验都不能替代授权；服务端必须继续按 token 和业务操作鉴权。

### 3.4 生命周期

物理连接状态建议为：

    idle → connecting → open → reconnecting → open
                         └───────────────→ closed/failed

页面 client 另有 attached / recovering / disposed 状态，避免把“某个 tab 离开”误解成“关闭所有 tab 的共享连接”。

关键规则：

- open() 幂等，可以等待连接 ready，并接受 AbortSignal。
- close() 只释放当前逻辑 client 的连接需求且允许再次 open；dispose() 是不可恢复终态。
- reconnect() 明确影响共享连接，并向所有 client 广播原因。
- 最后一个活跃 client 离开后经过短宽限期再关闭物理连接。
- 正常 detach 立即清理；页面崩溃或被杀死依赖 lease 过期清理。
- pageshow、visibility 恢复和 Worker 重启后，页面重新握手并重放内存中的鉴权 revision。
- 可选 lifecycle.restore 由库内部感知页面隐藏/冻结并自动恢复；业务只需继续使用 onMessage()。
- lifecycle.restore.replay 可启用 256 条/4 MiB 有界回放；超限固定丢弃最旧消息并报告 overflow。
- 不承诺 Worker 重启、lease 过期、页面终止或缓冲超限后的业务消息补偿；可靠恢复仍需要服务端 offset/cursor 协议。

### 3.5 队列、背压与投递语义

建议采用安全默认值：

- 断线业务发送默认拒绝，不默认无限排队。
- 调用方可为单次 send 显式启用排队；需要重放安全的业务应携带 idempotency key。
- 队列同时限制条数和总字节数，默认拒绝新消息，不静默丢旧消息。
- 页面 client 消失、鉴权清除、连接 id 改变时，清除它拥有的待发消息。
- sendMessage() 成功返回 accepted 或 queued，只代表本地状态；失败统一通过 Promise rejection 返回。
- 请求响应、Ack、超时、取消与幂等由业务协议通过 sendMessage() 和 onMessage() 自行实现，v1 不提供 request() / sendWithAck()。
- 监控 WebSocket.bufferedAmount，并提供高/低水位；必须在文档中说明原生 WebSocket 仍没有真正的入站背压。
- Worker 到页面的 fan-out 使用有界批次/credit，慢 client 的溢出策略显式可配。
- Worker 只等待页面运行时接收确认，不等待业务 onMessage handler；启用 restore 时暂停 client 的派发并按上限回放。

### 3.6 Worker 部署

默认零配置模式使用包内生成的稳定 data: URL。相同 WWS 版本在同一浏览器存储分区中得到相同 constructor URL，因此多个 tab 可以匹配到同一个 SharedWorker：

    const socket = createWebSocket('wss://api.example.com/realtime', {
      id: 'realtime:tenant-a:user-42',
    })

默认 Worker 是自包含的 classic 脚本，只注册 raw 与声明式 JSON adapter。它不使用每个 tab 都不同的 Blob URL。

高级场景由应用提供很小的同源 module Worker 入口：

    import { exposeSharedWebSocketWorker } from 'wws/worker'
    import { chatProtocol } from './chat-protocol'

    exposeSharedWebSocketWorker({
      protocols: { chat: chatProtocol },
    })

页面通过工厂覆盖默认 Worker：

    const socket = createWebSocket('wss://api.example.com/realtime', {
      worker: () => new SharedWorker(
        new URL('./wws.worker.ts', import.meta.url),
        { type: 'module' },
      ),
      id: 'realtime:tenant-a:user-42',
      protocol: chatProtocol,
    })

自定义 Worker 是以下场景的推荐方案：

- bundler 能跟踪应用源码中的 Worker 入口。
- 脚本可由同源部署并满足 CSP/Trusted Types。
- 自定义 adapter 可以静态注册。
- 同一个部署中的所有 tab 使用相同脚本 URL。

默认 data: Worker 具有 opaque origin，WebSocket 握手可能发送 Origin: null，并可能受 Cookie/SameSite 和 worker-src CSP 限制。它适合快速开始、raw/JSON 和首帧 token 鉴权；依赖同源 Origin/Cookie、严格 CSP、应用自定义 adapter 或微前端稳定部署时必须使用自定义 Worker。

多 SPA 或微前端若要稳定共享，应该共同引用一个由 shell/平台部署的固定、同源 Worker URL。协议 major 不兼容时使用新的 URL；不要依赖 Safari 尚未支持的 Worker name。

### 3.7 降级

首版建议只提供两个显式策略：

- direct：SharedWorker 不支持或初始化失败时，每个 tab 使用相同状态机建立直连，并暴露 transport = direct。
- error：拒绝降级，确保“最多一个连接”的性能约束不会被静默破坏。

不建议首版承诺 BroadcastChannel + Web Locks leader election。它会把物理连接放进可能被冻结的后台 tab；冻结但仍持锁时无法及时选主，行为与 SharedWorker 不等价。该能力可以在真实需求和独立 E2E 基线明确后作为单独 transport 增加。

普通网络错误、鉴权失败、心跳超时或服务端 close 不能触发 transport 降级，否则可能同时存在共享连接和页面直连。

## 4. API 草案

建议 API 组合为：

- createWebSocket(url, options)
- client.open({ signal })
- client.sendMessage(data, options)
- client.onMessage(handler)
- client.addEventListener('statechange' | 'message' | 'error' | 'diagnostic', handler)
- client.updateAuth(value, revision)
- client.updateUrl(url, revision)
- client.reconnect(reason)
- client.dispose()
- client.status / client.data / client.transport / client.diagnostics()

原则：

- 不返回底层 WebSocket；它不在页面线程，且关闭它会影响其他 tab。
- 不伪装 sendMessage() 为服务端确认。
- EventTarget、onMessage 与 AbortSignal 提供现代消费方式。
- 核心不依赖 React、Vue、RxJS 或 Node EventEmitter。
- 模块顶层不访问 window/self，保证 SSR 和构建期安全导入。

## 5. 功能覆盖建议

首版核心能力：

- raw text/binary
- 跨 tab 连接池
- open/message/error/close/state
- 手动/自动连接与重连
- connection timeout
- exponential backoff + jitter + stable window + retry limit
- 应用层 heartbeat
- bounded offline queue
- bufferedAmount 水位
- dynamic URL/auth revision
- page recovery
- direct/error fallback
- structured diagnostics
- SSR-safe import

后续协议/框架包候选：

- React adapter
- Vue adapter
- graphql-ws adapter
- STOMP adapter
- Socket.IO/Engine.IO adapter（只有明确需求时评估，不能假装 raw 兼容）

## 6. Monorepo 建议

参考 acplugin 的工程约定，但保持更小：

    packages/
    ├── wws/          # 唯一首发公开包；client、protocol、worker 子路径
    ├── core/         # 私有纯状态机与控制协议，构建时 bundle 进 wws
    ├── test/         # 私有跨包和 tarball consumer 测试
    ├── docs/         # 私有 VitePress + TypeDoc
    └── playground/   # 私有多 tab 示例与性能面板

可选框架/协议适配器在需求确认后放入 packages/adapters/*，每个适配器保持独立公开包和 peer dependency。

工程基线：

- pnpm 10 workspace + catalog，CI 使用 frozen lockfile。
- ESM-only、TypeScript strict、exactOptionalPropertyTypes、noUncheckedIndexedAccess。
- tsdown 多入口构建与声明文件，publint + arethetypeswrong 验证 tarball。
- Vitest 做纯状态机/协议测试，Playwright 同一 BrowserContext 打开多页做真实 SharedWorker E2E。
- Node ws 只作为测试服务器，不进入浏览器运行时依赖。
- Changesets、Conventional Commits、VitePress/TypeDoc。
- 不引入 Turborepo；当前规模用 pnpm filter 足够。

建议的公开导出：

    wws
    wws/protocol
    wws/worker

框架 adapter 不进入主包，避免让 vanilla 用户承担依赖和类型污染。

## 7. 必须验证的测试

- 两个及更多同源 tab 对同 key 只建立一条物理连接。
- 不同 key 建立不同物理连接。
- 相同 key 的配置冲突可重复、可诊断地失败。
- tab attach/detach、崩溃模拟、租约过期和最后一个 client 宽限关闭。
- bfcache/pagehide/pageshow、Worker 重启和 client/worker 协议版本不一致。
- lifecycle.restore 的隐藏/冻结暂停、重新激活恢复、回放顺序和缓冲溢出。
- 连接超时、close code 策略、退避抖动、稳定窗口和离线/在线切换。
- 心跳正常、丢 pong、服务端 ping 与业务消息不混淆。
- 队列条数/字节边界、FIFO、幂等要求、client 离开时清理。
- text/Blob/ArrayBuffer/typed array，广播时不错误 transfer/detach。
- 慢 client fan-out 上限与溢出策略。
- direct 与 error fallback，且普通网络错误不触发降级。
- CSP/错误 MIME/Worker 构造失败/TrustedScriptURL 接口。
- 发布 tarball 在最小 Vite consumer 中可构建、类型正确、Worker 可加载。

## 8. 待对齐决策

### D1 产品边界

推荐：raw WebSocket 通用内核 + declarative JSON + Worker 端自定义 adapter；首版不承诺直接兼容 Socket.IO、Centrifuge、graphql-ws 或 STOMP 的服务端协议。

需要确认：你说的“覆盖主流库功能”是指传输层能力，还是首版必须直接兼容某些协议？

### D2 首发包范围

推荐：首版只发布 framework-agnostic wws；React/Vue 与协议 adapter 在核心稳定后拆包。

需要确认：首版是否必须同时交付 React、Vue/Nuxt 或其他框架 adapter？

### D3 降级策略

推荐：实现 direct 与 error，由调用方显式选择；leader election 不进首版。

需要确认：是否接受 SharedWorker 不可用时每 tab 直连，还是性能约束要求必须失败？

### D4 Worker 交付

已确认：raw/声明式 JSON 默认使用稳定 data: URL 零配置 Worker；同源 Origin/Cookie、严格 CSP、自定义 adapter 和微前端场景通过 1 到 5 行应用 Worker 入口覆盖。

需要确认：是否有“零 Worker 文件、零构建配置”的硬要求？

### D5 发送与恢复语义

推荐：断线默认拒绝；显式、安全、有界排队；服务端确认和消息补偿由业务协议提供。

需要确认：业务是否要求断线期间默认缓存、exactly-once、断点续传或历史补偿？这些会要求服务端配合。

### D6 运行环境

推荐：ESM-only、现代浏览器、SSR-safe import；不支持 IE，不发布 CJS，不把 Node/React/Vue 放进核心。

需要确认：是否必须支持旧 Android WebView、CJS、Electron 或浏览器扩展？

### D7 部署形态

推荐：单 SPA 可使用 bundler 生成的统一 Worker URL；多 SPA/微前端由 shell 部署固定 Worker 入口。

需要确认：目标是单一 SPA 的多个 tab，还是同一 origin 下多个独立发布的 SPA/微前端也必须共享？

### D8 性能基线

需要提供或接受默认测试档位：

- tab：典型 3，压力 20。
- 每连接入站：典型 100 msg/s，压力 1,000 msg/s。
- payload：典型 1 KiB，压力 64 KiB。
- 队列：100 条与 1 MiB 双上限。

请给出真实的典型/峰值 tab 数、消息速率、payload 和二进制比例；否则 to-spec 将采用以上档位。

### D9 名称与许可证

仓库名与 npm 包名均确认为未 scoped 的 wws；调研时 npm 返回 404，当前名称可用。许可证推荐 MIT。

包名已确认；许可证仍需确认。

## 9. 阶段门

本文件得到确认并补齐 D1-D9 后，grill-with-docs 完成。下一阶段只做 to-spec：

- 把决策写成规范性 MUST/SHOULD/MAY。
- 固化公开 API、状态机、控制协议、错误码、浏览器矩阵和性能验收。
- 每项功能都配可执行验收条件。
- 不在 spec 对齐前创建实现代码。

## 10. 主要来源

- MDN SharedWorker: https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker
- MDN SharedWorker constructor: https://developer.mozilla.org/en-US/docs/Web/API/SharedWorker/SharedWorker
- MDN WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- WHATWG HTML Shared workers: https://html.spec.whatwg.org/multipage/workers.html#shared-workers-and-the-sharedworker-interface
- WHATWG WebSockets: https://websockets.spec.whatwg.org/
- MDN Browser Compat Data: https://github.com/mdn/browser-compat-data/blob/main/api/SharedWorker.json
- reconnecting-websocket: https://github.com/pladaria/reconnecting-websocket
- PartySocket: https://github.com/cloudflare/partykit/tree/main/packages/partysocket
- react-use-websocket: https://github.com/robtaussig/react-use-websocket
- Socket.IO client API: https://socket.io/docs/v4/client-api/
- Centrifuge JS: https://github.com/centrifugal/centrifuge-js
- graphql-ws: https://github.com/enisdenjo/graphql-ws
- Existing SharedWorker WebSocket examples considered:
  - https://github.com/dpawlikowski/shared-worker-ws
  - https://www.npmjs.com/package/@guozhi-fe/shared-websocket
  - https://www.npmjs.com/package/@elcrm/socket
