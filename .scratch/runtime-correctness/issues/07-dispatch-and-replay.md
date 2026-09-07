# 07 — 单接收者分派与有序回放

**What to build:** 单接收者分派与有序回放，使相应公开行为与已批准运行时规格一致。

**Blocked by:** 04。

**Status:** completed

- [x] dispatchKey API 替换旧 execution key；每帧携带 session/epoch/grant stamp，页面验证后才启动。
- [x] lease ping/pong 从发送时刻计有效期；迟到确认、freeze、close 与旧 receipt 不复活资格。
- [x] replay 仅普通 handler，单帧先验再淘汰、credit 不足保留队首；data 在实际 dispatch 前更新。

