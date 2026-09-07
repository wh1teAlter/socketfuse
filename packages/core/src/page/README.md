# page

本模块提供稳定 WebSocketClient，拥有独立 open waiter、参与意图、动态业务 handler、EventTarget 观察者、dispatchKey 本地资格门以及页面生命周期。每次 close/reopen 建立新的端口 session，dispose 永久终结；它不拥有 socket、连接池或 replay。

分派按每帧 session/epoch/grant 代际和保守 lease 检查，只抑制过期调用，不保证跨页面异步副作用互斥。keyed handler 不接收 replay；普通 handler 的 signal 在参与期结束时 abort。业务回调和日志独立隔离，不等待 Promise 才处理下一帧。

onBeforeReconnect 获得临时 URL/delay 授权，取消或期限结束立即禁止 setter。恢复先合并探测，失联则在同一选定 transport 建立新参与期。诊断为最近异步样本，data 只由实际业务派发更新。

依赖 config、shared、connection 状态映射、runtime 控制类型与 transport，不直接依赖 Worker 全局。公开使用者通过 socketfuse facade 创建实例。
