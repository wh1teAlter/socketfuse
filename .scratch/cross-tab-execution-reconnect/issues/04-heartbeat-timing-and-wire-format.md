# 04 — 分离 heartbeat 时序与线协议格式

**What to build:** 保留库对连接健康度与 timeout 的管理，但让 raw、JSON 和 custom adapter 各自定义可验证的 ping/pong 线格式，不把浏览器原生 WebSocket ping/pong 与应用层 heartbeat 混为一谈。

**Blocked by:** 01 — 删除 capabilities/ready；03 — heartbeat timeout 必须进入统一 reconnect plan

**Status:** completed

## Scope

- heartbeat 默认关闭；只有显式配置后才发送应用层 ping。
- 顶层 heartbeat 配置只管理时序：`interval`、发送模式与可选 `pongTimeout`；未配置 `pongTimeout` 时不因未收到 pong 主动重连。
- raw adapter 默认使用字符串 `ping`/`pong`，并允许配置字符串、`ArrayBuffer` 或类型化数组视图做精确匹配；`Blob` 只用于普通 raw 消息。
- JSON adapter 允许用结构化 matcher 匹配任意字段，包括 `messageType`，并生成对应结构化 ping/pong。
- custom adapter 通过 `createPing`、frame classification/matcher 与可选 `createPong` 定义线协议，不再声明静态 heartbeat capability。
- raw 专属 payload 字段在 JSON/custom 模式下明确拒绝，避免静默忽略。
- 同一时刻最多存在一个 ping interval 和一个 pong deadline；open、close、reconnect、dispose 均正确清理。
- heartbeat timeout 只报告稳定 reason，并交给统一 reconnect plan；不新增 native heartbeat 模式。

## Invariants

- 浏览器管理 RFC 6455 原生 control-frame ping/pong；库不伪装、拦截或暴露原生 pong 开关。
- JSON 中 `{ "messageType": "ping" }` / `{ "messageType": "pong" }` 与任意其他字段形状都可由 matcher 表达。
- heartbeat frame 是否进入业务消息分发遵循 adapter classification 的既有协议边界，不靠 auth/ready 状态。
- 未启用 heartbeat 时，字符串 endpoint、消息投递和重连行为与现有基础用法一致。

## Acceptance

- [x] 默认配置不发送 ping，也不会因 pong 缺失触发 timeout。
- [x] raw 默认字符串 ping/pong、raw 自定义字符串和二进制 payload 均有 round-trip 测试。
- [x] JSON matcher 能匹配 `messageType` 等自定义字段，并按配置生成 ping/pong。
- [x] custom adapter 能生成 ping、识别 pong、可选响应对端 ping，且无需 capabilities。
- [x] 只有显式 `pongTimeout` 到期才产生 heartbeat-timeout reconnect plan。
- [x] timer 清理、重复 pong、迟到 pong、断开和重连竞态都有 fake-timer 覆盖。

## Verification

- `pnpm typecheck`
- `pnpm test`
- `git diff --check`
