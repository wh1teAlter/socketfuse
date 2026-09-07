# connection

此模块只拥有一个物理 WebSocket 的状态机、连接尝试、不可变重连计划、心跳、发送队列和背压。

它不依赖 `runtime`、`page` 或 `worker`。一个 controller 只通知一个内部 ConnectionObserver；上层 runtime 拥有参与者和 fan-out。连接层只接收是否有需求，以及供取消未发送项的不透明 owner 标记。

原生 socket 使用 ArrayBuffer，同步协议转换之后只把 data/control 帧交给 runtime。当前尝试的协议回复与心跳立即发送且有边界；页面业务发送进入一套有界 FIFO，由唯一 drain timer 推进。异步返回是协议契约错误。

自动断开、连接/心跳超时、页面或 Worker 显式重连及同 epoch 恢复需求共用预算。计划接纳先预留，实际调用 socket 工厂才扣数；不计数不补额度。计划身份覆盖准备直至新尝试 open/失败，旧 socket 未确认关闭前不得启动替代连接。准备只一次原子提交 URL/delay；连接不知道准备者是谁。发送成功只代表本地 accepted 或 queued。
