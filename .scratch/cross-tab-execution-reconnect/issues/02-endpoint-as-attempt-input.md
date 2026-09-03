# 02 — 将 endpoint 收敛为连接尝试输入

**What to build:** 把完整 WebSocket URL 从共享连接身份中分离出来：创建共享条目的页面提供首次连接 URL，后续页面只按显式 `id` 与共享配置加入，不得用自身 URL 覆盖存量连接。

**Blocked by:** 01 — 先删除 auth/revision 等会影响配置形状与 fingerprint 的应用协议状态

**Status:** completed

## Scope

- 初始化 API 只接受已经求值完成的绝对 `ws:`/`wss:` 字符串；不接受 getter、`URL`、Promise、模板或变量 register。
- 配置归一化将 URL 作为 connection-attempt input 单独保存，不把 URL、query 或 fragment 纳入共享 fingerprint。
- 同一作用域内，相同 `id` 且共享配置一致时允许 attach，即使后加入页面传入不同 URL；后加入 URL 不得更新 controller 当前或下一次连接地址。
- 相同 `id` 但真正的共享配置不同仍返回现有配置冲突；不得因为 URL 被排除而放宽其他冲突检查。
- 条目在 idle grace 后完全释放时，下一位创建者提供新的首次连接 URL。
- reconnect 期间只有当前 reconnect plan 的 `setOptions({ url })` 能为该次尝试更新 URL。
- 保持 URL 数据最小化：完整 URL、query 和应用凭据不得进入 diagnostics、logger、错误详情或控制面回显。

## Invariants

- `id` 是调用方声明的共享连接身份，不是 URL、credential 或 endpoint 内容的散列。
- 后加入页面的 URL 既不冲突也不覆盖；“最后写入者获胜”不是合法语义。
- 运行中不提供独立 `updateUrl()`、endpoint getter、模板、`setVar()` 或 `clearVar()` 路径。
- direct transport 仍直接使用当前实例初始化时传入的固定 URL。

## Acceptance

- [x] direct/shared 首次连接均使用创建者传入的固定 URL。
- [x] 两个页面用相同 `id`、相同共享配置、不同 URL attach 时只建立一条物理连接，且第二个 URL 不生效。
- [x] 条目完全释放并重新创建后，新创建者的 URL 生效。
- [x] 除 URL 之外的共享配置差异仍稳定返回配置冲突。
- [x] 非绝对 URL、非 `ws:`/`wss:` scheme 和包含禁止字段的选项在页面侧同步失败。
- [x] fingerprint、diagnostics、logger、控制帧错误和测试快照中不出现完整 URL 或 query 值。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`
