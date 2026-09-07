# 02 — 同步协议与尝试隔离

**What to build:** 同步协议与尝试隔离，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 01 — 统一输入与安全错误。

**Status:** completed

- [x] 协议转换和心跳同步；删除 OrderedProtocol/outgoingTail。
- [x] Promise/thenable 契约违例终止并消费 rejection；旧 socket/旧 timer 不能更新新尝试。
- [x] raw 原生 ArrayBuffer、页面 Blob 表示转换；custom 页面描述符与 Worker 实现分离。

