---
"socketfuse": patch
---

修复原型不是 `Object.prototype` 的入站 payload 在 SharedWorker 下被整帧丢弃的缺陷。投递额度会计此前把「无法精确估算」当作「超过上限」，因此自定义适配器 `decode` 返回类实例、`Error` 或容器内含这类值时，无论 payload 多小都只会收到 `overflow` 而收不到消息，同一份代码在 `direct` 降级路径下却正常。现在业务 payload 按自有可枚举属性计入额度，真正不可结构化克隆的函数与 symbol 仍视为超限。页面本地 restore 回放缓冲存在同一缺陷，一并修复。

补充文档：Worker 到页面的 4 MiB 既是未确认投递总额度，也是单条消息硬上限——单帧超限会被直接丢弃且不随额度恢复重投，需要更大 payload 时应在应用协议内分片；该限制只作用于 SharedWorker 通道，`direct` 不受投递额度与单帧上限约束。同时说明 close code 1000 是唯一被视为终态、默认不重连的关闭码，以及如何用适配器 `shouldReconnect` 覆盖。
