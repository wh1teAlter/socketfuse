---
"socketfuse": patch
---

修复启用 `lifecycle.restore.replay` 时，页面暂停瞬间已在途的消息被丢弃而没有回放的问题。页面暂停后才到达的投递现在会退回 runtime 回放缓冲，并按原顺序在恢复后回放。页面与 Worker 的控制协议主版本升至 4，使用自定义 Worker URL 的应用需要随页面一起重新构建并部署 Worker。
