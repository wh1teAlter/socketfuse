---
schema: plugydown.context.document/v1
id: socket-runtime.message-delivery
description: 区分连接级协议动作、按页分派、回放与本地发送回执。
kind: architecture
domain: socket-runtime
relations:
  related:
    - socket-runtime.connection-ownership
code:
  paths:
    - packages/core/src/runtime/host.ts
    - packages/core/src/runtime/delivery.ts
    - packages/core/src/page/client.ts
    - packages/core/src/connection/controller.ts
    - packages/core/src/transport/port.ts
    - packages/core/src/worker/README.md
    - CONTEXT.md
---

# 消息投递

入站数据由连接层解码。runtime 对每个 data/control 帧调用一次已注册的同步 `onFrame`，校验结果后执行协议回复、业务投影派发及可选的重连请求。协议 Ack 和跨帧应用状态属于连接作用域扩展。Worker 派发事件后继续处理连接，页面各自执行本地 handler。

同一实时帧在每个 `dispatchKey` 下至多选中一个参与者；先前 handler 的异步副作用可能仍在运行。页面回放只使用有界保存的业务投影，不再进入连接级协议处理，也不重放 keyed handler。修改分派时应分别验证实时接收者、慢页面的投递额度和回放。

出站 `sendMessage()` 的成功回执表示原生发送已接纳或进入有界队列。请求发出后若丢失确认，页面收到 `SEND_OUTCOME_UNKNOWN`。此时重试可能重复发送，服务端确认与幂等策略由应用协议决定。
