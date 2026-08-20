# WWS v1 实现票据

- 阶段：to-tickets
- 来源：[WWS v1 技术与产品规格](../specs/wws-v1-spec.md)
- 前置调研：[SharedWorker WebSocket 方案调研与决策清单](01-sharedworker-websocket-grill.md)
- 状态：待用户确认，确认前不得进入 implement

本文将 v1 规格拆成有依赖关系、可独立验收的实现票据。票据不扩大规格范围；v1 不实现 `subscribe()`、`messages()`、`request()`、`sendWithAck()`、协议 correlation、Ack、Service Worker transport 或 BroadcastChannel/Web Locks 选主。

## 1. 交付顺序

```text
T001 工程骨架
  └─ T002 公开契约与错误
       ├─ T003 配置规范化与指纹
       ├─ T004 队列与背压
       ├─ T005 连接状态机
       └─ T006 协议 adapter
            └─ T007 控制协议与 Worker runtime
                 └─ T008 共享连接控制器
                      ├─ T009 页面 client 与 SharedWorker transport
                      ├─ T010 direct fallback
                      ├─ T011 lifecycle.restore 回放
                      └─ T012 inline/custom Worker 构建交付
                           ├─ T013 单元/集成 contract suite
                           ├─ T014 Playwright 真实浏览器 E2E
                           ├─ T015 文档与 Playground
                           └─ T016 tarball/release verify
```

建议按该顺序串行推进核心票据；T013 可在 T003-T012 完成后并行补齐测试，T015 可在公开 API 稳定后并行推进。

## 2. 票据

### T001 工程骨架与发布基线

- 目标：建立参考 acplugin 的 pnpm 10 monorepo，并保证空仓库可以安装、类型检查和构建。
- 依赖：无。
- 涉及包/文件：`package.json`、`pnpm-workspace.yaml`、`.npmrc`、`tsconfig.base.json`、`packages/wws`、`packages/core`、`packages/test`、`packages/docs`、`packages/playground`、Changesets 配置、CI 配置。
- 实现范围：pnpm catalog、workspace protocol、ESM-only、Node engine、严格 TypeScript 编译选项、根脚本、tsdown 多入口占位配置、测试和文档脚本。
- 测试：`pnpm install --frozen-lockfile`；根 `lint`、`typecheck`、`build`、`test`、`docs:check` 脚本可执行。
- 验收：满足规格 4.1、4.2 的目录和工具链约束；不引入 Turborepo；公开包名为 `wws`。
- 完成定义：产生可被后续票据引用的 workspace，不能包含实现逻辑或隐式 runtime 依赖。

### T002 公开 API、事件类型与稳定错误

- 目标：固化 `createWebSocket()`、`WebSocketClient`、`WwsMessageEvent`、`SendReceipt`、生命周期选项和 `WwsError` 的 TypeScript 契约。
- 依赖：T001。
- 涉及包/文件：`packages/core/src/types`、`packages/core/src/errors`、`packages/wws/src/index.ts`、`packages/wws/src/protocol.ts`。
- 实现范围：只导出规格中的 API；包含 `onMessage()`、`sendMessage()`、`open/close/reconnect/dispose`、auth/url revision、`lifecycle.restore`、`replayed` 字段；不得添加 subscribe/messages/request/Ack API。
- 测试：类型级 API smoke test；非法 options、非法 revision、非法生命周期上限的同步校验测试。
- 验收：AC-011、AC-018、AC-019；公开入口不访问浏览器全局。
- 完成定义：根入口、`wws/protocol`、`wws/worker` 的类型边界明确，后续实现不得通过 any 绕过契约。

### T003 配置规范化、共享指纹与 revision register

- 目标：实现 id、protocols、adapter、binaryType、重连/心跳/队列/backpressure/lease/limits 的规范化与稳定指纹，并实现独立的 endpoint/auth revision register。
- 依赖：T002。
- 涉及包/文件：`packages/core/src/config`、`packages/core/src/revision`。
- 实现范围：相同 `id + 共享配置` 复用；配置冲突返回 `CONNECTION_CONFIG_CONFLICT`；URL/auth revision 单调更新；auth 不进入指纹、日志或 diagnostics；lifecycle.restore 属于 client-local 设置，不引发配置冲突。
- 测试：字段顺序、默认值、subprotocol 顺序、JSON sharedConfig、不同 binaryType、URL/auth stale/equal/new revision、敏感字段脱敏 golden test。
- 验收：AC-001、AC-002、AC-003、AC-018、AC-023。
- 完成定义：指纹算法是纯函数且有固定测试向量；worker/page/direct 使用同一实现。

### T004 出站队列、消息编码计数与 socket 背压

- 目标：实现 `sendMessage()` 的 accepted/queued receipt、Promise rejection、FIFO 队列和 bufferedAmount 水位。
- 依赖：T002、T003。
- 涉及包/文件：`packages/core/src/queue`、`packages/core/src/backpressure`。
- 实现范围：默认断线/背压拒绝；实例级 queue 和单次 `SendOptions.queue` 覆盖；100 条/1 MiB 队列上限；单条 1 MiB；消息字节计数；owner 清理；重连 ready 后 flush；不实现服务端 Ack。
- 测试：string/Blob/ArrayBuffer/ArrayBufferView 字节计数；FIFO、双上限、单条上限、owner 清理、clearAuth 清理、backpressure 高低水位和 receipt/rejection。
- 验收：AC-010、AC-011、AC-013。
- 完成定义：队列实现不依赖 Worker DOM API；任何失败都返回稳定 WwsError，不出现 rejected receipt。

### T005 纯连接状态机、重连、超时与心跳

- 目标：实现 shared-worker/direct 共用的物理连接状态机。
- 依赖：T003、T004。
- 涉及包/文件：`packages/core/src/connection`、`packages/core/src/reconnect`、`packages/core/src/heartbeat`。
- 实现范围：connecting/handshaking/open/reconnecting/closing/idle/failed；connection timeout 10 秒；指数退避、jitter、stable threshold、retry exhaustion；服务端 1000 不重连；应用层 heartbeat 默认关闭，true 使用 ping/pong 默认值；普通网络/鉴权/心跳错误不触发 direct。
- 测试：fake clock/random 覆盖状态转换、非法转换、退避公式、稳定窗口、超时、close code、heartbeat timeout 和 timer 清理。
- 验收：AC-008、AC-009、AC-015、AC-017。
- 完成定义：状态机不直接依赖页面、SharedWorker 或具体 WebSocket 实现，WebSocket/clock/logger 均可注入。

### T006 raw 与声明式 JSON adapter

- 目标：实现 raw、JSON 和自定义 adapter 的统一契约，不引入请求/确认能力。
- 依赖：T002、T003、T005。
- 涉及包/文件：`packages/core/src/protocol`、`packages/wws/src/protocol.ts`。
- 实现范围：encode/decode/classify、ready/auth/ping/pong/ignore/fatal；raw 支持文本和二进制；JSON matcher/template 字段路径语法、结构化克隆验证和稳定配置指纹；adapter 错误映射为 ENCODE_FAILED/DECODE_FAILED/PROTOCOL_ERROR。
- 测试：golden frames、字段路径/matcher/template 校验、decode/classify 顺序、异步 adapter 顺序、错误隔离、raw 二进制内容一致性。
- 验收：AC-013、AC-017、AC-019。
- 完成定义：adapter 可在 Worker 与 direct 中复用；不包含 topic、subscribe、request、reply 或 correlation 分类。

### T007 控制协议、端口握手与 Worker runtime 骨架

- 目标：实现 page-to-worker 版本化控制协议、port 生命周期和 runtime 入口。
- 依赖：T003、T005、T006。
- 涉及包/文件：`packages/core/src/control`、`packages/core/src/worker-runtime`、`packages/wws/src/worker.ts`。
- 实现范围：hello/welcome/attach/detach/status/message/send/lease/probe/suspend/restore/recover 等 envelope；runtime validation；worker instance id；max ports、握手超时、messageerror 隔离；不信任同源页面输入。
- 测试：非法 envelope、版本不匹配、过大控制消息、单 port 崩溃隔离、hello/attach 超时和 worker dispose timer 清理。
- 验收：AC-017、AC-019、AC-020。
- 完成定义：控制协议只使用可结构化克隆数据；页面与 Worker 对所有请求/响应均有运行时校验。

### T008 共享 ConnectionController 与广播 fan-out

- 目标：在 Worker 内按 id 管理物理 WebSocket，并完成多 client 广播、demand、idle grace 和 lease 回收。
- 依赖：T004、T005、T006、T007。
- 涉及包/文件：`packages/core/src/connection-pool`、`packages/core/src/fanout`、Worker runtime 连接注册表。
- 实现范围：相同 id/config 单物理连接；不同 id 独立连接；入站按到达顺序 decode/classify 后广播；内部帧不进入业务消息；页面 runtime receive ack 不等待 handler；最后 client 5 秒宽限关闭；lease 20 秒/60 秒默认值；二进制 fan-out 不错误 transfer/detach。
- 测试：多 client 单连接、配置冲突、close/dispose 隔离、idle grace、lease expiry、广播顺序、二进制多 port 内容一致性、慢 client credit/overflow。
- 验收：AC-001 至 AC-007、AC-012、AC-013、AC-014。
- 完成定义：ConnectionController 不暴露底层 WebSocket；任一 client 的异常不破坏既有健康 client。

### T009 页面 client 与 SharedWorker transport

- 目标：实现稳定的 `WebSocketClient` 页面实例和 SharedWorker 主通道。
- 依赖：T002、T003、T006、T007、T008。
- 涉及包/文件：`packages/core/src/page-client`、`packages/core/src/transports/shared-worker.ts`、`packages/wws/src/index.ts`。
- 实现范围：状态/data/status/readyState/diagnostics；动态 onMessage handler；创建期便捷回调；open/close/reconnect/dispose；auth/url revision；EventTarget 事件；AbortSignal；message `replayed` 标记。
- 测试：多 handler 注册/取消/抛错隔离、data 更新顺序、close/dispose 清理、状态映射、AbortSignal、diagnostics 脱敏。
- 验收：AC-004、AC-005、AC-007、AC-011、AC-018、AC-019。
- 完成定义：client 对象稳定且不返回底层 WebSocket；shared-worker transport 选择后不自动切换 transport。

### T010 direct transport 与 fallback 判定

- 目标：在 Worker 初始化链路失败时提供与 SharedWorker 相同语义的页面直连。
- 依赖：T005、T006、T009。
- 涉及包/文件：`packages/core/src/transports/direct.ts`、`packages/core/src/transport-selection.ts`。
- 实现范围：Worker API/构造/加载/握手/adapter 注册失败判定；fallback direct/error；direct 使用相同状态机、adapter、queue、heartbeat、auth/url revision 和事件；网络、鉴权、心跳、服务端 close 不降级。
- 测试：每类允许/禁止降级错误、fallback:error 不建立 WebSocket、direct/shared contract suite 一致、workerMode/transport diagnostics。
- 验收：AC-015、AC-016、AC-019、AC-021。
- 完成定义：transport 一旦选择不自动来回切换；direct 只改变连接共享范围。

### T011 lifecycle.restore 与有界回放

- 目标：实现页面生命周期感知、当前 client suspend/restore 和可选回放，不增加业务 restore 回调。
- 依赖：T008、T009、T010。
- 涉及包/文件：`packages/core/src/page-lifecycle`、`packages/core/src/replay-buffer`、控制协议 suspend/restore handlers。
- 实现范围：visibilitychange/pagehide/pageshow；可用时接入 freeze/resume；`lifecycle.restore` 默认关闭；replay 默认关闭；replay 开启时 256 条/4 MiB、固定 drop-oldest、按到达顺序回放、`replayed: true`；Worker 只等页面运行时接收确认，不等 handler；lease 过期/Worker 重启不承诺补偿。
- 测试：SharedWorker/direct 同一 contract；suspend/restore、replay 顺序、overflow、handler 不阻塞、BFCache、lease 过期和 Worker 重启边界。
- 验收：AC-006、AC-007、AC-012、AC-023。
- 完成定义：业务只需 onMessage 与 lifecycle 配置；没有公开 restore 事件或 suspend/resume 方法。

### T012 inline data Worker、custom Worker 和多入口构建

- 目标：交付零配置稳定 data: SharedWorker，并支持 custom Worker factory 与静态 adapter 注册。
- 依赖：T007、T008、T009、T010、T011。
- 涉及包/文件：`packages/wws/src/inline-worker`、`packages/wws/src/worker`、`packages/wws/tsdown.config.ts`、Worker 构建脚本。
- 实现范围：固定内容 data URL；inline 内置完整 runtime/raw/JSON；custom worker exports；MIME/CSP/Trusted Types 文档约束；SSR-safe import；公开 exports `wws`、`wws/protocol`、`wws/worker`。
- 测试：同版本 constructor URL 稳定性、跨 tab Worker 复用、custom Worker 静态 adapter、CSP/构造失败 fallback、Node SSR import、包 exports。
- 验收：AC-001、AC-015、AC-019、AC-020、AC-021。
- 完成定义：公开 tarball 不引用私有 workspace 包，不从 CDN 加载 Worker 代码，不拼接用户输入 Worker URL。

### T013 单元、集成与 contract test suite

- 目标：建立可注入边界下的完整自动化测试门槛。
- 依赖：T003-T012（可按模块提前补测）。
- 涉及包/文件：`packages/test/unit`、`packages/test/integration`、共享 fake clock/random/WebSocket/MessagePort-like fixtures。
- 实现范围：纯 core 单测、Worker runtime 集成、direct/shared 同一 contract suite、diagnostics 脱敏和资源清理测试。
- 验收：覆盖规格 23.1、23.2 全部项目；AC-001 至 AC-018 至少各有自动化映射。
- 完成定义：测试不依赖真实网络，失败信息可定位到 ticket 和 AC。

### T014 Playwright 真实浏览器 E2E 与 ws 测试服务

- 目标：验证跨 tab 物理连接复用、生命周期恢复和降级行为。
- 依赖：T012、T013。
- 涉及包/文件：`packages/test/e2e`、`packages/test/server`、Playwright 配置。
- 实现范围：Chromium/Firefox/WebKit；2/3/20 pages；服务端连接计数；close/reconnect/heartbeat/binary/visibility/BFCache/Worker restart；Worker 初始化错误与 direct/error fallback。
- 测试：真实 ws 服务端注入消息速率和 payload 档位；不支持 freeze/resume 的 engine 验证 visibility/pageshow 兜底，不无说明 skip。
- 验收：AC-001、AC-004、AC-005、AC-007、AC-009、AC-013、AC-014、AC-015、AC-016、AC-021。
- 完成定义：E2E 报告记录浏览器、transport、物理连接计数和丢弃/回放统计。

### T015 文档、示例与 Playground

- 目标：让用户能正确部署、配置和诊断 WWS，而不是只提供类型定义。
- 依赖：T009、T011、T012。
- 涉及包/文件：`packages/docs`、根 README、`packages/playground`。
- 实现范围：五分钟 quick start；raw/JSON/custom adapter；CSP/MIME/Trusted Types/data URL；id/config conflict；fallback；queue/backpressure；lifecycle.restore/replay；兼容矩阵；错误码和 diagnostics；多 tab 面板。
- 测试：docs build/check；Playground typecheck/build；示例必须只使用公开 API，不依赖 demo-only runtime。
- 验收：规格 24 全部项目；AC-018、AC-019、AC-020。
- 完成定义：文档明确说明 Origin null、Cookie/SameSite、冻结不可可靠观测和回放非持久化限制。

### T016 tarball、类型、构建与 release verify

- 目标：在发布前验证真实 npm tarball 的消费和包质量。
- 依赖：T001、T012、T013、T015。
- 涉及包/文件：`packages/test/tarball`、release scripts、Changesets、CI workflow。
- 实现范围：tsdown browser/ESM/ES2022、多入口 declarations/sourcemaps、sideEffects、publint、arethetypeswrong、pack 临时目录、Vite consumer、Node SSR import、Worker 加载检查。
- 测试：根 `lint`、`typecheck`、`test`、`test:e2e`、`build`、`docs:check`、`release:verify` 和 `check`。
- 验收：AC-019、AC-020、AC-022。
- 完成定义：真实 tarball 不包含私有 workspace 依赖、源码绝对路径或无关文件；不自动 publish/tag/release。

## 3. AC 映射

| AC                 | 覆盖票据                                 |
| ------------------ | ---------------------------------------- |
| AC-001/002/003     | T003, T007, T008, T012, T013, T014       |
| AC-004/005/006/007 | T008, T009, T011, T013, T014             |
| AC-008/009         | T005, T013, T014                         |
| AC-010/011         | T004, T009, T013                         |
| AC-012/013/014     | T004, T006, T008, T011, T013, T014       |
| AC-015/016/017     | T005, T007, T010, T012, T013, T014       |
| AC-018             | T002, T003, T009, T015                   |
| AC-019/020         | T001, T002, T007, T009, T012, T015, T016 |
| AC-021             | T010, T012, T014                         |
| AC-022             | T013, T014, T015, T016                   |
| AC-023             | T003, T011, T013                         |

## 4. 全局完成定义

- 所有票据的实现和测试都不得引入 `subscribe()`、`messages()`、`request()`、`sendWithAck()` 或服务端 Ack 抽象。
- SharedWorker 与 direct 使用同一套公开语义，差异只在物理连接共享范围。
- 所有公开 API 和默认值以 v1 spec 为准；发现规格冲突时先回到 to-spec 更新规格，不在票据中私自决策。
- 每个票据必须在提交说明或变更记录中标明覆盖的 AC。
- implement 阶段结束前不得 publish、创建 tag 或 GitHub Release。
