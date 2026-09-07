# 05 — Worker 自定义收到确认与协议动作

**What to build:** Worker 自定义收到确认与协议动作，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 04。

**Status:** completed

- [x] 每帧同步 onFrame 在 fan-out 前一次执行；consume/投影/reply/reconnect 先验后按规定顺序执行。
- [x] 三个页面不会重复 Ack；回放/暂停/加入不重新处理协议；回复仅当前尝试且有大小背压限制。
- [x] 扩展 stateful 心跳为唯一生成来源，onSocketClose 恰好通知一次；异步违例终止。
- [x] Worker 与页面显式恢复共用任务 03 的预算，预算拒绝不关闭健康连接。

