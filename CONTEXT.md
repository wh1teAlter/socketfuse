# SocketFuse 领域词汇

SocketFuse 在同源浏览器页面之间共享物理 WebSocket，同时保留页面本地的处理器与生命周期。以下词汇用于区分共享身份、连接所有权、页面执行权、重连控制权与应用协议状态。

## Language

**共享连接（shared connection）**：
同一 SharedWorker 中由相同 `id` 与共享配置唯一确定的一条物理 WebSocket。
_Avoid_: 全局连接、页面连接

**共享连接标识（connection id）**：
应用对一类共享连接意图给出的稳定名称；相同标识表示调用方明确要求复用同一条共享连接。它不是凭据、授权边界或某次连接使用的 endpoint。
_Avoid_: auth key、socket URL、租户凭据

**逻辑 client（logical client）**：
一个页面对共享连接的本地参与者，拥有自己的处理器、事件与生命周期。
_Avoid_: socket、物理连接

**执行 key（execution key）**：
由业务命名、以共享连接为作用域的处理器执行身份；相同 key 在任一时刻至多授权一个逻辑 client 启动新的 handler 调用。
_Avoid_: 锁、topic、连接 id

**key 持有者（key holder）**：
Worker 当前授权执行某个 execution key 对应处理器的逻辑 client。它不拥有物理 WebSocket。
_Avoid_: socket owner、leader

**重连计划（reconnect plan）**：
Worker 为一次重新建连创建的短生命周期决策，包含代际、原因、默认延迟以及页面在总准备期限内提交的 URL 和延迟覆盖。
_Avoid_: reconnect callback、重连锁

**重连候选页（reconnect candidate）**：
注册了 `onBeforeReconnect`、可被 Worker 选择来准备当前重连计划的逻辑 client。
_Avoid_: primary tab、master page

**连接尝试参数（connection-attempt options）**：
只对一次物理连接尝试生效的 endpoint 与等待时间；它们可以在下一次尝试前重新生成，不构成持久共享状态。
_Avoid_: 共享配置、连接变量、endpoint register

**应用协议状态（application protocol state）**：
凭据、认证进度、业务就绪、游标、确认与会话等由应用定义和拥有的状态。SocketFuse 只传输应用消息，不为这些概念保存或排序状态。
_Avoid_: SocketFuse auth、Worker session、revision register

**协议适配器（protocol adapter）**：
把应用选择的 wire format 映射为 SocketFuse 可编码、解码和识别的帧类别的无状态规则。它只描述格式，不保存跨帧状态，也不拥有凭据、会话或应用就绪状态。
_Avoid_: auth provider、session manager、业务状态机

**连接作用域业务扩展（connection-scoped extension）**：
在 SharedWorker 内、以一条共享连接为作用域运行一次的业务逻辑，用于所有标签页共同需要的入站过滤与重连准备。它由应用在自己的 Worker 文件中提供，生命周期与共享连接一致，不随标签页增减而重复执行。
_Avoid_: 中间件、插件、协议适配器

**入站过滤（inbound filter）**：
连接作用域业务扩展对已解码业务帧做出的「继续派发或整条丢弃」判定。丢弃在投递给任何标签页之前发生，因此不消耗任何页面的投递额度。它不改写 payload，也不承诺服务端 exactly-once。
_Avoid_: dedupe 中间件、拦截器、消息网关

**连接尝试准备（attempt preparation）**：
在下一次物理连接尝试前，为当前重连计划提交 endpoint 与延迟的过程。它可由 Worker 内的连接作用域业务扩展完成，也可回退到某个候选页面的 `onBeforeReconnect`；两者对同一计划互斥。
_Avoid_: 重连中间件、连接工厂
