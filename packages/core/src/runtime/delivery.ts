/** 每参与期的有界投递与唯一回放缓冲；缓存只接受 runtime 已取得的业务投影快照。 */
import type { NormalizedRestoreOptions, WorkerResourceLimits } from '../shared/types'
import type { DispatchStamp, WorkerControlMessage } from './control'
import { estimateStructuredCloneBytes } from '../shared/structured'

/** 一条库拥有的业务投影；replay 不保存分派授权或重跑协议处理。 */
interface ReplayItem {
  /** 已克隆且之后不再修改的数据。 */
  readonly data: unknown
  /** 原物理接收时间。 */
  readonly receivedAt: number
  /** 本条保留表示的预算。 */
  readonly bytes: number
}

/** 一个端口拥有的 delivery credit 和暂停/恢复 FIFO。 */
export class ParticipantDelivery {
  /** 尚未由页面传输层收取的 envelope 字节。 */
  private readonly outstanding = new Map<number, number>()
  /** 尚未归还的总字节。 */
  private outstandingBytes = 0
  /** 单参与期不复用的投递序号。 */
  private sequence = 0
  /** 唯一回放队列。 */
  private readonly replay: ReplayItem[] = []
  /** 回放保留字节总和。 */
  private replayBytes = 0
  /** 是否暂停业务派发。 */
  private suspended = false
  /** 参与期结束后不再接纳任何投递。 */
  private disposed = false
  /** 无 receipt 时至多保留一个未确认溢出通知。 */
  private overflowNotified = false
  /** 按方向累计未报告的丢弃，不为每次丢弃发送无限控制帧。 */
  private readonly dropped = [
    { direction: 'inbound', strategy: 'drop-newest', messages: 0, bytes: 0 },
    { direction: 'replay', strategy: 'drop-newest', messages: 0, bytes: 0 },
    { direction: 'replay', strategy: 'drop-oldest', messages: 0, bytes: 0 },
  ] satisfies { direction: 'inbound' | 'replay', strategy: 'drop-newest' | 'drop-oldest', messages: number, bytes: number }[]

  /** 绑定一个参与期；post 失败必须由 runtime 回收所属端口。 */
  constructor(private readonly sessionId: string, private readonly epoch: string, private readonly restore: NormalizedRestoreOptions,
    private readonly limits: WorkerResourceLimits, private readonly post: (message: WorkerControlMessage) => boolean) {}

  /** 接纳实时投影；恢复中的新消息接在同一回放缓冲尾部，不越过旧项。 */
  deliver(data: unknown, receivedAt: number, dispatch: readonly DispatchStamp[]): void {
    if (this.disposed)
      return
    if (this.suspended || this.replay.length > 0) {
      if (this.restore.replay)
        this.pushReplay(data, receivedAt)
      if (!this.suspended)
        this.drain()
      return
    }
    // 包含参与期和授权元数据的投递 envelope。
    const message = this.envelope(data, receivedAt, false, dispatch)
    // 实际保留或投递表示的预算，不只计算可见业务值。
    const bytes = estimateStructuredCloneBytes(message, this.limits.maxDeliveryBytes)
    if (!this.canPost(bytes)) {
      this.drop('inbound', bytes)
      return
    }
    this.send(message, bytes)
  }

  /** receipt 仅归还当前 session 已发送的项；重复/过期 receipt 不改变计费。 */
  receipt(deliveryId: number): void {
    // 实际保留或投递表示的预算，不只计算可见业务值。
    const bytes = this.outstanding.get(deliveryId)
    if (bytes === undefined || this.disposed)
      return
    this.outstanding.delete(deliveryId)
    this.outstandingBytes -= bytes
    this.overflowNotified = false
    this.notifyOverflow()
    this.drain()
  }

  /** 暂停业务派发，连接协议处理仍由 controller/runtime 继续。 */
  suspend(): void {
    this.suspended = true
  }

  /** 恢复后按 credit 排空 FIFO，keyed handler 永不补跑旧帧。 */
  resume(): void {
    this.suspended = false
    this.overflowNotified = false
    this.notifyOverflow()
    this.drain()
  }

  /** 参与期终结时清空全部库持有数据和额度。 */
  dispose(): void {
    this.disposed = true
    this.replay.length = 0
    this.replayBytes = 0
    this.outstanding.clear()
    this.outstandingBytes = 0
  }

  /** 为候选投递生成包含全部资格元数据的 envelope，序号只在成功接纳前提交。 */
  private envelope(data: unknown, receivedAt: number, replayed: boolean, dispatch: readonly DispatchStamp[]): Extract<WorkerControlMessage, { type: 'message' }> {
    return { type: 'message', sessionId: this.sessionId, connectionEpoch: this.epoch, data, receivedAt, replayed, dispatch, deliveryId: this.sequence + 1 }
  }

  /** 判断本条和累计额度，不涉及页面业务 Promise 并发。 */
  private canPost(bytes: number): boolean {
    return bytes <= this.limits.maxDeliveryBytes && this.outstanding.size < this.limits.maxDeliveryMessages
      && this.outstandingBytes + bytes <= this.limits.maxDeliveryBytes
  }

  /** 先登记额度再发送，防止同步测试端口归还 receipt 时找不到项。 */
  private send(message: Extract<WorkerControlMessage, { type: 'message' }>, bytes: number): boolean {
    this.sequence = message.deliveryId
    this.outstanding.set(message.deliveryId, bytes)
    this.outstandingBytes += bytes
    return this.post(message)
  }

  /** 超大新帧只丢自己；容得下的帧才允许按 oldest-first 淘汰旧缓存。 */
  private pushReplay(data: unknown, receivedAt: number): void {
    // 实际保留或投递表示的预算，不只计算可见业务值。
    const bytes = estimateStructuredCloneBytes(data, this.restore.maxBytes)
    if (bytes > this.restore.maxBytes) {
      this.drop('replay', bytes)
      return
    }
    while (this.replay.length >= this.restore.maxMessages || this.replayBytes + bytes > this.restore.maxBytes) {
      // 被 FIFO 容量策略淘汰的旧缓存项。
      const removed = this.replay.shift()
      if (removed === undefined)
        break
      this.replayBytes -= removed.bytes
      this.drop('replay', removed.bytes, 'drop-oldest')
    }
    this.replay.push({ data, receivedAt, bytes })
    this.replayBytes += bytes
  }

  /** 有 credit 才移除回放队首，真实发送前始终保留原顺序。 */
  private drain(): void {
    if (this.suspended || this.disposed)
      return
    while (this.replay.length > 0) {
      // 尚未取得投递 credit 的回放队首。
      const item = this.replay[0]
      if (item === undefined)
        return
      // 包含参与期和授权元数据的投递 envelope。
      const message = this.envelope(item.data, item.receivedAt, true, [])
      // 实际保留或投递表示的预算，不只计算可见业务值。
      const bytes = estimateStructuredCloneBytes(message, this.limits.maxDeliveryBytes)
      if (bytes > this.limits.maxDeliveryBytes) {
        this.replay.shift()
        this.replayBytes -= item.bytes
        this.drop('replay', bytes)
        continue
      }
      if (!this.canPost(bytes))
        return
      this.replay.shift()
      this.replayBytes -= item.bytes
      if (!this.send(message, bytes))
        return
    }
  }

  /** 有限计数累计溢出，避免不合作页面使通知本身无限排队。 */
  private drop(direction: 'inbound' | 'replay', bytes: number, strategy: 'drop-newest' | 'drop-oldest' = 'drop-newest'): void {
    // 同方向同丢弃策略的有限累计计数。
    const counter = this.dropped.find(item => item.direction === direction && item.strategy === strategy)
    if (counter === undefined)
      return
    counter.messages = Math.min(Number.MAX_SAFE_INTEGER, counter.messages + 1)
    counter.bytes = Math.min(Number.MAX_SAFE_INTEGER, counter.bytes + bytes)
    this.notifyOverflow()
  }

  /** 在有推进机会时发送累计溢出；业务 receipt 之前不会逐帧重复发送。 */
  private notifyOverflow(): void {
    if (this.disposed || this.overflowNotified)
      return
    for (const counter of this.dropped) {
      if (counter.messages === 0)
        continue
      this.overflowNotified = true
      // 包含参与期和授权元数据的投递 envelope。
      const message: WorkerControlMessage = { type: 'overflow', sessionId: this.sessionId, direction: counter.direction, strategy: counter.strategy, droppedMessages: counter.messages, droppedBytes: counter.bytes }
      counter.messages = 0
      counter.bytes = 0
      this.post(message)
      break
    }
  }
}
