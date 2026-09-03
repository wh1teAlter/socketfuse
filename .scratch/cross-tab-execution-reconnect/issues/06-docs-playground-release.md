# 06 — 交付文档、Playground、发布契约与最终评审

**What to build:** 从公开文档、示例、真实 tarball 和三浏览器验收统一呈现最终架构边界，并删除所有已废弃协议状态叙述。

**Blocked by:** 01 — 删除应用协议状态；02 — endpoint 边界；03 — reconnect lifecycle；04 — heartbeat；05 — execution key

**Status:** completed

## Scope

- 同步根 README、模块 README、文档站指南/API reference、TypeDoc 注释和示例。
- 明确应用拥有 credential/auth/session/业务 ready/Ack/cursor/idempotency；库不提供入站 dedupe 或 exactly-once。
- 删除 auth/updateAuth/clearAuth、revision、adapter ready、capabilities、`SendOptions.idempotencyKey`、reconnect reason 和 endpoint 模板相关内容。
- 提供应用外部 getter 示例：初始化前求值得到固定 URL；`onBeforeReconnect` 内重新调用应用方法并用 `setOptions({ url })` / `setDelay()` 提交。
- 提供 JSON `messageType` ping/pong、raw 默认字符串 heartbeat 和浏览器 native ping/pong 边界示例。
- Playground 使用现有结构演示 keyed/unkeyed handler、Worker 权威 held 状态、close/freeze 转移和 reconnect URL/delay；不新增独立包。
- 通过正式 build 流程再生成 Worker 产物，不手工修改 generated 文件。
- 更新一份面向使用者的 `socketfuse` breaking Changeset；不手工修改版本和 CHANGELOG。
- implement 完成后按 AGENTS.md、ADR 与 accepted spec 做独立 code-review，修复阻断问题再交付。

## Invariants

- 文档不能承诺业务幂等、exactly-once、冻结后强制终止已开始 handler 或 direct 模式跨标签页独占。
- 示例中的 token/cursor 只作为应用自有数据展示，不引入库内领域抽象。
- 全量 check 与 e2e 不并行运行，避免两个流程同时构建 `dist`。
- Changeset 和发布验收反映实际公开 API，不为旧未发布 API 保留兼容层。

## Acceptance

- [x] 搜索文档、声明文件、生成 Worker 和 tarball 后，不再出现被删除的公开 API/控制帧/旧语义。
- [x] 文档能直接回答固定初始化 URL、外部 getter 重连、heartbeat `messageType`、execution key 与业务幂等边界。
- [x] Playground 可人工验证每页都收到帧、同 key 单页执行、持有状态与转移。
- [x] Chromium、Firefox、WebKit 从公开入口通过多标签页 execution key、reconnect plan 和 heartbeat 验收。
- [x] TypeDoc、真实 tarball、SSR import、strict-control 与发布 API 契约验收通过。
- [x] Changeset 存在且准确描述 breaking removal 和新增能力，版本与 CHANGELOG 未被直接修改。
- [x] 最终 code-review 无未处理的正确性、安全、资源泄漏或文档阻断项。

## Verification

按顺序执行，禁止并行构建：

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. `pnpm build`
5. `pnpm docs:check`
6. `pnpm release:verify`
7. `pnpm test:e2e`
8. `git diff --check`
