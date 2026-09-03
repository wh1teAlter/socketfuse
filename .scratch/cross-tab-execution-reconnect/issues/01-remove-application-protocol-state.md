# 01 — 删除应用协议状态与误导性 API

**What to build:** 从公开类型、connection、transport 和 Worker 控制面完整删除 auth/revision、adapter-ready、声明式 capabilities 与无行为的幂等字段，让 SocketFuse 的 open 只表示原生 WebSocket 已打开。

**Blocked by:** None — first implementation ticket

**Status:** completed

## Scope

- 删除全部 `Auth` 泛型、`updateAuth()`、`clearAuth()`、`RevisionReceipt`、`AuthContext`、`JsonAuthTemplate`、`ProtocolAdapter.createAuth` 与 `$auth` 模板替换。
- 删除 `connection/revision.ts` 及其测试、页面认证重放、controller authReady/sendAuth、Worker auth 控制帧和认证专用错误码。
- 删除 `JsonProtocolOptions.ready`、`ProtocolFrame.ready`、`readyWhen` 与 `handshaking`；native socket open 直接进入 open。
- 删除 `ProtocolCapabilities`、client/adapter `capabilities` 与不再可达的 `CAPABILITY_UNSUPPORTED`；需要 heartbeat 的 adapter 直接按方法/config 校验。
- 删除 `SendOptions.idempotencyKey` 及队列项字段；不增加入站 dedupe/idempotency 替代 API。
- 内置 JSON adapter 固定自身 id/version；custom adapter 继续使用注册所需的稳定 id/version。

## Invariants

- 应用凭据、认证、session、业务 ready、Ack、游标与幂等状态不得进入 Worker 管理状态、fingerprint、diagnostics 或 logger。
- Worker 不执行页面函数，也不等待应用认证或业务 handler。
- JSON/custom heartbeat 的任意字段 matcher、raw 透传、queue/backpressure、key 与 reconnect plan 行为不能被本次删除破坏。
- 不保留 deprecated alias、兼容控制帧或第二套协议状态抽象。

## Acceptance

- [x] `WebSocketClient`、`CreateWebSocketOptions` 与 `ProtocolAdapter` 只保留 Incoming/Outgoing 类型参数。
- [x] 公开入口、core exports、源码、严格控制 parser、生成 Worker 和发布 tarball 均无 auth/revision/ready/capability/idempotency API。
- [x] 原生 open 后 `open()` resolve、状态和每页 `onConnected` 顺序稳定；应用随后可用普通 `sendMessage()` 发送初始化帧。
- [x] 删除相关测试并补负向类型/发布验收，证明已删除符号无法从三个公开入口导入。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm release:verify`
- `git diff --check`
