/** 为出站消息提供按数量和字节双重限制的 FIFO 队列。 */
import type { SocketData } from '../shared/types'
import { snapshotSocketData, socketDataByteLength } from '../shared/bytes'
import { SocketFuseError } from '../shared/errors'

/** 库持有的不可变出站快照及其取消归属。 */
export interface OutboundQueueItem {
  /** 产生该项的页面 client id，用于 detach 时只移除所属消息。 */
  readonly ownerId: string
  /** 已编码、可直接传给原生 socket 的 payload。 */
  readonly data: SocketData
  /** 编码 payload 的字节数。 */
  readonly bytes: number
  /** SocketFuse 本地生成的消息标识。 */
  readonly messageId: string
  /** 全局入队序列，用于诊断和保持顺序语义。 */
  readonly sequence: number
}

/** 不包含消息内容的队列用量。 */
export interface QueueSnapshot {
  /** 当前队列消息数。 */
  readonly messages: number
  /** 当前队列编码字节数。 */
  readonly bytes: number
}

/** 以双重容量限制保留按接纳顺序发送的 wire 快照。 */
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
      throw new SocketFuseError('INVALID_OPTIONS')
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
  ): { item: OutboundQueueItem, position: number } {
    const bytes = socketDataByteLength(data)
    if (bytes > this.maxBytes)
      throw new SocketFuseError('MESSAGE_TOO_LARGE')
    if (this.entries.length >= this.maxMessages)
      throw new SocketFuseError('QUEUE_FULL')
    if (this.totalBytes + bytes > this.maxBytes)
      throw new SocketFuseError('QUEUE_BYTES_EXCEEDED')
    // 先完成容量判定再复制，queued 后调用方不能改写内容或扩大保留内存。
    const item: OutboundQueueItem = { bytes, data: snapshotSocketData(data), messageId, ownerId, sequence: ++this.sequence }
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
