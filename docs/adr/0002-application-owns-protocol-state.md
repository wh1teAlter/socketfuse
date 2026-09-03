---
status: accepted
---

# 应用拥有认证与协议状态

SocketFuse 不再定义 auth、认证 revision、协议就绪或连接变量；应用在库外生成初始 URL，在连接打开后通过普通业务消息推进认证、会话与就绪状态，并在重连计划中重新生成下一次 URL。保留协议 adapter 的编码、解码及应用层 heartbeat 分类，是因为 Worker 必须在不等待页面的前提下维护 wire format 和连接存活；用通用变量 register 或 pre-ready 帧替代 auth 会把同一份应用状态管理重新放回库内。

## Consequences

- 删除 `updateAuth`、`clearAuth`、`JsonAuthTemplate`、`AuthContext`、auth capability、revision register 与 `handshaking`/adapter-ready 状态，不提供兼容别名。
- `open`/`onConnected` 只表示原生 WebSocket 已打开；认证成功、业务 ready、Ack 与游标由应用自行建模。
- JSON/custom heartbeat 仍可按任意字段（包括 `messageType`）生成和匹配 ping/pong，但这些规则不保存应用会话状态。
- SocketFuse 不接受入站幂等检查函数，也不保存业务消息 ID；它只派发帧并 gate keyed handler，重复判断与副作用事务留在应用 handler 内。
