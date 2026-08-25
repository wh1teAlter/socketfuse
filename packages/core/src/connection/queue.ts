/** 为出站消息提供按数量和字节双重限制的 FIFO 队列。 */
import type { SocketData } from '../shared/types'
import { socketDataByteLength } from '../shared/bytes'
import { WwsError } from '../shared/errors'

export interface OutboundQueueItem {
  /** 产生该项的页面 client id，用于 detach 时只移除所属消息。 */
  readonly ownerId: string
  /** 已编码、可直接传给原生 socket 的 payload。 */
  readonly data: SocketData
  /** 编码 payload 的字节数。 */
  readonly bytes: number
  /** WWS 本地生成的消息标识。 */
  readonly messageId: string
  /** 可选业务幂等键，WWS 不解释其服务端语义。 */
  readonly idempotencyKey?: string
  /** 全局入队序列，用于诊断和保持顺序语义。 */
  readonly sequence: number
}

export interface QueueSnapshot {
  /** 当前队列消息数。 */
  readonly messages: number
  /** 当前队列编码字节数。 */
  readonly bytes: number
}

export class OutboundQueue {
  /** FIFO 消息容器，保持发送顺序。 */
  private readonly entries: OutboundQueueItem[] = []
  /** 队列当前编码字节数，必须等于 entries.bytes 总和。 */
  private totalBytes = 0
  /** 为每个入队项分配的单调序列。 */
  private sequence = 0

  /** 创建具有消息数和字节双重上限的 FIFO 队列。 */
  constructor(readonly maxMessages: number, readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxMessages) || maxMessages <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new WwsError('INVALID_OPTIONS', 'Queue limits must be positive safe integers')
  }

  /** 返回当前消息数量。 */
  get size(): number {
    return this.entries.length
  }

  /** 返回当前编码字节数。 */
  get bytes(): number {
    return this.totalBytes
  }

  /** 返回当前计数快照，不暴露内部数组。 */
  snapshot(): QueueSnapshot {
    return { bytes: this.totalBytes, messages: this.entries.length }
  }

  /** 编码后入队；任一上限不足时拒绝且不修改队列。 */
  enqueue(
    ownerId: string,
    data: SocketData,
    messageId: string,
    idempotencyKey?: string,
  ): { item: OutboundQueueItem, position: number } {
    const bytes = socketDataByteLength(data)
    if (bytes > this.maxBytes)
      throw new WwsError('MESSAGE_TOO_LARGE', 'Message exceeds queue byte limit', { details: { bytes, maxBytes: this.maxBytes } })
    if (this.entries.length >= this.maxMessages)
      throw new WwsError('QUEUE_FULL', 'Outbound queue message limit reached', { details: { maxMessages: this.maxMessages } })
    if (this.totalBytes + bytes > this.maxBytes)
      throw new WwsError('QUEUE_BYTES_EXCEEDED', 'Outbound queue byte limit reached', { details: { bytes: this.totalBytes, maxBytes: this.maxBytes } })
    const item: OutboundQueueItem = idempotencyKey === undefined
      ? { bytes, data, messageId, ownerId, sequence: ++this.sequence }
      : { bytes, data, idempotencyKey, messageId, ownerId, sequence: ++this.sequence }
    this.entries.push(item)
    this.totalBytes += bytes
    return { item, position: this.entries.length }
  }

  /** 查看队首但不移除。 */
  peek(): OutboundQueueItem | undefined {
    return this.entries[0]
  }

  /** 移除并返回队首，同时维护字节计数。 */
  shift(): OutboundQueueItem | undefined {
    const item = this.entries.shift()
    if (item !== undefined)
      this.totalBytes -= item.bytes
    return item
  }

  /** 移除指定 client 拥有的消息并返回移除数量。 */
  removeOwner(ownerId: string): number {
    return this.removeWhere(item => item.ownerId === ownerId)
  }

  /** 清空全部消息并返回清空前数量。 */
  clear(): number {
    const count = this.entries.length
    this.entries.length = 0
    this.totalBytes = 0
    return count
  }

  /** 按 FIFO 尝试冲刷；发送函数返回 false 时保留当前项及后续项。 */
  drain(send: (item: OutboundQueueItem) => boolean): number {
    let count = 0
    while (this.entries.length > 0) {
      const item = this.peek()
      if (item === undefined || !send(item))
        break
      this.shift()
      count++
    }
    return count
  }

  /** 按谓词过滤并维护队列字节不变量。 */
  private removeWhere(predicate: (item: OutboundQueueItem) => boolean): number {
    let removed = 0
    for (let index = this.entries.length - 1; index >= 0; index--) {
      const item = this.entries[index]
      if (item !== undefined && predicate(item)) {
        this.entries.splice(index, 1)
        this.totalBytes -= item.bytes
        removed++
      }
    }
    return removed
  }
}
