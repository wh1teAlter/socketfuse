# 可执行设计与判定表

**Status:** accepted for implementation；以下不是已实现声明。

## 设计树的已决分支

| 前提 | 决策 | 证据与可执行后果 |
| --- | --- | --- |
| 相同共享配置必须有相同语义 | shared/direct 使用同一 runtime | 删除 DirectTransport 的连接池和直连 sink；direct 仅提供 MessageChannel 端口。 |
| 协议收到确认属于一次物理帧 | onFrame 在 fan-out 前执行 | consume 不投递；投影最多一个，reply 最多一个；replay 只保留投影。 |
| 页面暂停不能阻塞连接协议 | 同步 adapter/帧处理、异步页面 handler | 不等待页面业务 Promise；准备事务是唯一受控的连接异步 hook。 |
| 重连最多三次不能被触发来源重置 | 一个预算、一次预留、启动扣数 | 计数和不计数请求只改变该次计划；不同策略冲突拒绝。 |
| lease 不能强制取消已运行副作用 | 分派资格按帧固定 | 收窄为单接收者分派；过期抑制不等于分布式互斥。 |
| 自定义 Worker 逻辑不能在 fallback 丢失 | custom Worker 禁止 direct | 缺 Worker API、构造或握手失败均报错；内联模式才可按策略降级。 |
| 同一 id 不允许双 socket | 等待原生关闭再替代/回收 | close 未完成时保持同一条目；没有“超时遗弃后再创建”路径。 |

## 所有权与原子提交点

- page 拥有稳定 client、desired participation、waiter 和业务注册；PortTransport 拥有一个端口参与期及其待决操作。transport 的选择属于稳定 client，不属于可释放端口。
- runtime 拥有 id → 条目、参与者、idle timer、扩展、分派候选和 delivery/replay；connection 拥有唯一 socket、attempt、出站队列、心跳、预算与计划。
- attach 先校验 canonical、额度、adapter 和扩展，再提交参与者并表达需求；任一失败均回滚未提交条目。hello 不访问连接池。
- 重连原子接纳点：校验 epoch/attempt/plan、检查并预留预算、固定计划策略；完成后才通知准备来源及结束旧尝试。预留失败不修改健康连接。
- 准备原子提交点：检查计划仍有效和绝对 deadline、校验全部 URL/delay，再一次性提交并结束事务。先断开 active 引用、清 timer、禁 setter，后 abort signal。
- 原生 socket 工厂调用是 attempt 递增及计数预留转已用的唯一位置；工厂抛错也消耗一次已启动计数尝试。
- 退出尝试先标记失效、清 attempt timer/心跳、结算并封存连续稳定窗口，再通知扩展和页面。socket 的关闭监听仍保留至 CLOSED，以便守住唯一 socket。

## 状态与竞态判定

| 当前状态/事件 | 接纳结果与下一步 |
| --- | --- |
| client 未参与，open(signal 已 abort) | ABORTED；不产生端口或需求。 |
| 未参与，open | 注册有界 waiter，建立新端口，hello/welcome，attach；状态快照或事件完成 waiter。 |
| 正在 attach，重复 open/send | open 增加独立 waiter；send 在同一预算内保存不可变快照；不重复 attach。 |
| 已参与，open(signal 后 abort) | 只拒绝对应 waiter；不撤销参与需求。 |
| 正在 attach/已参与，close | 立即 gate、撤销资格、拒绝本期 waiter/未 post 发送；最终 detach 和关端口。 |
| 正在 close，open，再 close | 合并最新 desired state；最后 close 取消尚未开始的新参与，旧 finally 不清理新端口。 |
| 任意状态 dispose | 立即永久终态；资源释放失败可以 reject，但不能恢复参与。 |
| 最后参与者离开 | 开始 idle 宽限；取消未启动计划/准备，socket 尚 open 可处理协议回复。 |
| idle timer 到期同时新 attach | runtime 串行决定；新需求若先到取消回收，否则等旧 socket 关闭再在原条目推进。 |
| 原生 socket 正常 close 1000 | 默认 closed、不自动重连；显式请求仍可按预算恢复。 |
| adapter fatal / 同步 hook 返回 thenable | failed、关闭 socket、取消计划；该条目不能以不计数恢复。 |
| 预算耗尽且健康 | RETRY_EXHAUSTED，保持健康和稳定计时；明确不计数仍可接纳。 |
| 同计划同 countAsRetry 再请求 | 加入现有计划，包括新 socket connecting 期间；不重启期限或多扣数。 |
| 同计划不同 countAsRetry 再请求 | RECONNECT_IN_PROGRESS；已有计划保持。 |
| 旧 attempt 的请求到达，新 attempt 已 open | STALE_RECONNECT_PLAN；不得替代新 socket。 |
| 默认不计数尝试失败 | 尝试已经结束；后续自动恢复为新的计数计划。 |
| 稳定 timer 与重连同一时刻 | 接纳前先按实际连续 open 时间结算；接纳后封存窗口，不能清掉新预留。 |

## 控制协议第三版

每个端口只绑定一个 session，端口 listener 的闭包同时核验当前 session 对象；旧端口消息无法转入新参与期。所有记录使用 exact-key 校验，未知字段拒绝。

| 消息 | 必要数据 | 处理结果 |
| --- | --- | --- |
| hello | requestId、protocolMajor | welcome 含 Worker 实例身份、major、静态资源限制；不创建条目。 |
| attach | requestId、sessionId、id、url、shared、canonical、restore、visibility、注册意图 | 校验后返回带 connectionEpoch/attempt/版本的快照及安全诊断；URL 不回传。 |
| detach | requestId、sessionId | 删除参与者及其未发送数据、delivery、replay、资格和候选；响应后关端口。 |
| send | requestId、sessionId、data、可选 queue | 同步编码并本地接纳/入队，立即返回 receipt 或安全错误。 |
| reconnect | requestId、sessionId、connectionEpoch、observed attempt、可选 planId、countAsRetry | 校验关联状态，接纳或加入计划后立即确认。 |
| registration/visibility | sessionId、有界注册集合/可见性 | 更新本地参与意图；不由页面声明 grant 或预算。 |
| lease/probe | sessionId、单调序号 | 对应确认携带 epoch 和 grant 代际；本地有效期从发送时刻计算。 |
| delivery receipt | sessionId、deliveryId | 只释放匹配参与期内 outstanding 项；不等待业务回调。 |
| prepare completion/rejection | sessionId、planId、准备授权代际、URL/delay 草案 | 仅当前候选可一次提交，过期拒绝且不泄露草案。 |
| message | sessionId、epoch、deliveryId、receivedAt、replayed、data、dispatch stamps | 全 envelope 计费；page 先收取 receipt 再更新 data 和调用 handler。 |

具体控制消息允许按现有命名合并简单操作，不增加公共控制协议入口或通用 RPC。版本不匹配显式失败；不提供旧版控制协议兼容。

## 输入、效果和资源边界

- 页面 custom protocol 只接受描述符，adapter 的函数只在 Worker 静态注册；创建时拒绝函数形状的旧 custom 选项。raw/JSON 内置实现从同一描述重建。
- 全部毫秒配置为平台范围整数，URL 拒绝 userinfo、任何 fragment 和非绝对 ws/wss；默认只在页面应用，runtime 对完整配置使用同一 validator。
- decode/classify 及 onFrame 的 thenable 是终止性违约；普通 throw 按阶段拒绝发送或消费帧并报告。异步 rejected 返回必须消费，避免 unhandled rejection。
- 处理结果必须为无未知字段的 consume/broadcast、可选 reply、可选 reconnect；先验证完整形状与投影 clone 预算，再执行 reply → projection → reconnect。每步重验 attempt；任何失败不广播原始控制帧。
- 协议回复及心跳不排队；业务队列保存紧凑自有编码值，FIFO 推進只有一个 timer。送入 native send 前后核验当前尝试，异常不能返回 accepted 或消费队首。
- pending 用户操作每参与期最多 64 个、总预算 4 MiB；未 post 发送持有快照，post 后仅持有 request 结算信息。短控制期限 5 秒，open 不使用此期限等待网络。
- 维护消息另有固定保留容量：一个生命周期过渡、一个 lease/probe、一个合并诊断刷新；receipt 不进入 Promise pending 表。
- 准备来源每个最多一个未 settle 调用，realm 最多 16 个。取消不释放尚未 settle 的任务额度；忙时采用默认计划，Worker 准备存在时不转交页面。
- replay 单帧先验再驱逐旧项，credit 不足保留队首；恢复中的新数据追加同一有界缓冲。keyed handler 不接收 replay。
- 输入预算检查拒绝 accessor、共享 buffer、不可克隆/无法估算的图。不能承诺不执行任意 Proxy trap；原生 clone 拒绝 Proxy，接收 clone 后重新计费。
- 所有错误对象由稳定 code 映射安全文本，无 details/cause；应用伪造的 SocketFuseError 也重新按调用阶段映射。

## 回归对应

| 既有 finding | 对应交付 |
| --- | --- |
| F01 | 分派 stamp、保守 lease 检查与契约收窄。 |
| F02 | 永久 transport 选择、新端口参与期、close/reopen/恢复统一。 |
| F03 | 唯一 drain pump、入队唤醒、业务 FIFO。 |
| F04 | backing buffer 克隆计费与紧凑队列快照。 |
| F05 | 安全错误出口、应用错误按阶段重映射。 |
| F06 | 同步协议及全部尝试回调守卫。 |
| F07 | 无 dist 可独立运行且验收同一 tarball。 |
| F08 | 页面独立 open waiter 的 AbortSignal。 |
| F09 | 短控制确认与网络 open waiter 分离。 |
| F10 | logger/所有外部回调不抛出边界。 |
| F11 | 准备事务取消及未结算额度。 |
| F12 | 当前 attempt 连续稳定窗口，断线时间不累计。 |
| F13 | replay 超大新帧不能淘汰旧缓存。 |
| F14 | runtime 按参与期统一池回收。 |
| F15 | 从当前 endpoint 生成安全快照。 |
| F16 | data 仅由最终 dispatch 更新。 |
| F17 | 抖动后再次 clamp 并取整。 |
| F18 | 页面/runtime 共享严格数值 validator。 |
| F19 | 尽力投递、接纳与协议 Ack 分别明示。 |
| F20 | epoch 内物理 attempt 单调，预算独立。 |
| F21 | 全部 Promise API rejection 一致。 |
| F22 | 发布现状、使用指南与模块 README 同步。 |

## 实施和审查判定

依赖迁移与公开类型更名共享一次集成，期间不承诺中间状态可发布。每张任务验收针对可观察行为；适当运行单文件回归和 typecheck，最终按仓库顺序跑完整链。最终审查须分别列出规范和规格结果，主代理重演每项 finding，修正后只重复受影响检查，并如实记录仍未验证的边界。
