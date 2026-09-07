# SocketFuse 领域词汇

SocketFuse 在同源浏览器页面之间共享物理 WebSocket，同时保留页面本地的处理器与生命周期。以下词汇区分共享身份、连接尝试、页面参与、消息分派与应用协议状态；本次调整采用[运行时重设计方案](docs/specs/runtime-correctness-redesign.md)的目标语言。

## Language

**共享连接（shared connection）**：
一个共享域中由相同 `id` 与共享配置确定的逻辑连接，其生命周期可以跨越多次物理 WebSocket 尝试。
_Avoid_: 全局连接、单个 socket、页面连接

**共享域（sharing scope）**：
允许一组逻辑 client 复用共享连接的边界；不同共享域之间没有连接复用或分派接收者唯一性的保证。
_Avoid_: 授权域、全局单例

**物理连接尝试（connection attempt）**：
从发起一次原生 WebSocket 建连，到该次连接终止的完整生命周期；自动重试和显式重连都会产生新尝试。
_Avoid_: 共享连接、重试预算、逻辑 client

**共享连接标识（connection id）**：
应用对一类共享连接意图给出的稳定名称；相同标识表示调用方明确要求复用同一条共享连接。它不是凭据、授权边界或某次连接使用的 endpoint。
_Avoid_: auth key、socket URL、租户凭据

**逻辑 client（logical client）**：
一个页面对共享连接的本地参与者，拥有自己的处理器、事件与生命周期。
_Avoid_: socket、物理连接

**参与期（participation）**：
逻辑 client 从一次 open 意图开始，到 close、dispose 或通道失效结束的共享连接参与关系；同一 client 可以先后拥有不同参与期。
_Avoid_: client 实例、物理连接尝试

**分派 key（dispatch key）**：
由业务命名、以共享连接为作用域的单接收者消息分派身份；同一入站帧在同一 key 下至多选择一个参与期。
_Avoid_: 执行锁、互斥 key、topic、连接 id

**分派接收者（dispatch owner）**：
当前被选中接收某个分派 key 实时消息的参与者。它不拥有物理 WebSocket，也不取得对跨页面副作用的互斥保证。
_Avoid_: socket owner、执行锁持有者

**重连计划（reconnect plan）**：
连接拥有方为一次重新建连创建的短生命周期决策，包含原因、预算使用方式、默认延迟以及准备方在总期限内提交的 URL 和延迟覆盖。
_Avoid_: reconnect callback、重连锁

**重连预算（reconnect budget）**：
同一共享连接在一个预算周期内允许启动的计数重连次数；页面加入、触发来源变化或请求不计数重连不会清空已用次数。
_Avoid_: 页面重试次数、物理 attempt 编号

**计数重连（counted reconnect）**：
实际启动新的物理尝试时消耗一次共享重连预算的重连；提出请求、准备计划和重复加入同一计划均不另扣次数。
_Avoid_: 自动重连、失败次数

**不计数重连（uncounted reconnect）**：
由调用方明确选择、不消耗共享重连预算的重连；它仍产生新的物理尝试，也不恢复之前已经消耗的预算。
_Avoid_: 重置重试、隐式无限恢复

**重连候选页（reconnect candidate）**：
注册了 `onBeforeReconnect`、可被 Worker 选择来准备当前重连计划的逻辑 client。
_Avoid_: primary tab、master page

**连接尝试参数（connection-attempt options）**：
只对一次物理连接尝试生效的 endpoint 与等待时间；它们可以在下一次尝试前重新生成，不构成持久共享状态。
_Avoid_: 共享配置、连接变量、endpoint register

**应用协议状态（application protocol state）**：
凭据、认证进度、业务就绪、游标、确认与会话等由应用定义和拥有的状态。应用可以在 Worker 的连接作用域处理器中维护它们；SocketFuse 不预设其协议含义。
_Avoid_: SocketFuse auth、Worker session、revision register

**协议适配器（protocol adapter）**：
把应用选择的 wire format 同步映射为 SocketFuse 可编码、解码和识别的帧类别的无状态规则。它只描述格式，不保存跨帧状态，也不拥有凭据、会话或应用就绪状态。
_Avoid_: auth provider、session manager、业务状态机

**连接作用域业务扩展（connection-scoped extension）**：
在 SharedWorker 内、以一条共享连接为作用域运行一次的应用逻辑，用于所有标签页共同需要的协议处理、业务消息投影与重连准备。它由应用在自己的 Worker 文件中提供，生命周期与共享连接一致，不随标签页增减而重复执行。
_Avoid_: 中间件、插件、协议适配器

**连接帧处理器（connection frame handler）**：
应用对一条已解码入站帧进行连接级处理的入口，可以消费协议帧、生成协议回复、请求重连，或产生供页面接收的业务消息。它按收到的物理帧执行，不按标签页执行。
_Avoid_: 页面 onMessage、纯格式 adapter

**协议确认（protocol acknowledgement）**：
应用协议定义的 Ack 消息，其确认对象和成功条件由协议决定。它不等于 SocketFuse 的本地发送回执或端口 credit receipt。
_Avoid_: 本地 queued、端口 receipt、默认业务处理成功

**业务投影（business projection）**：
连接帧处理器从一条已解码入站帧产生供页面接收的业务值，或消费该帧而不派发。协议回复与控制指令可在页面投递之前完成；只对投影后的业务值应用实时分派和回放，不重新执行连接协议。
_Avoid_: 页面 Ack、协议原帧广播、可靠消息交付

**连接尝试准备（attempt preparation）**：
在下一次物理连接尝试前，为当前重连计划提交 endpoint 与延迟的过程。它可由 Worker 内的连接作用域业务扩展完成，也可回退到某个候选页面的 `onBeforeReconnect`；两者对同一计划互斥。
_Avoid_: 重连中间件、连接工厂

**本地接纳回执（local send receipt）**：
确认消息已交给原生 WebSocket，或已进入有界本地队列的结果；它不证明服务端收到或业务处理成功。
_Avoid_: 服务端 Ack、送达回执、业务成功

**接纳结果未知（unknown send outcome）**：
通道中断导致页面无法确认某次发送是否已被本地接纳的状态；它不能被解释为消息一定未发送。
_Avoid_: 确认未发送、可安全自动重试
