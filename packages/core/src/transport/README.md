# transport

本模块把页面参与期接入统一 runtime。direct 使用当前 realm 的真实 MessageChannel；shared 使用 SharedWorker MessagePort。PortTransport 拥有请求预算、短控制期限、能力握手、端口监听与 lease 确认，不拥有 socket、连接池、回放或准备候选。

两者共用结构化克隆、投递额度与错误语义。稳定 client 的选择器在 welcome 后永久提交 transport；close/reopen 只更换 session 和端口。内联 Worker 支持/构造/加载/握手失败可按 fallback 选择 direct，自定义 Worker 始终报错，已选 shared 的故障不能改变选择。

本模块依赖 runtime 和 shared。页面通过选择器与 PortTransport 提交意图；原生 socket 能力面属于 connection，候选协调属于 runtime。单个参与期最多 64 个用户操作/4 MiB，维护请求有独立固定容量；发送 post 后失去确认不自动重发。
