import type { SocketData } from './types'
import { socketDataByteLength } from './bytes'
import { WwsError } from './errors'

export interface OutboundQueueItem {
  readonly ownerId: string
  readonly data: SocketData
  readonly bytes: number
  readonly messageId: string
  readonly idempotencyKey?: string
  readonly sequence: number
}

export interface QueueSnapshot {
  readonly messages: number
  readonly bytes: number
}

export class OutboundQueue {
  private readonly entries: OutboundQueueItem[] = []
  private totalBytes = 0
  private sequence = 0

  constructor(readonly maxMessages: number, readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxMessages) || maxMessages <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
      throw new WwsError('INVALID_OPTIONS', 'Queue limits must be positive safe integers')
  }

  get size(): number {
    return this.entries.length
  }

  get bytes(): number {
    return this.totalBytes
  }

  snapshot(): QueueSnapshot {
    return { bytes: this.totalBytes, messages: this.entries.length }
  }

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

  peek(): OutboundQueueItem | undefined {
    return this.entries[0]
  }

  shift(): OutboundQueueItem | undefined {
    const item = this.entries.shift()
    if (item !== undefined)
      this.totalBytes -= item.bytes
    return item
  }

  removeOwner(ownerId: string): number {
    return this.removeWhere(item => item.ownerId === ownerId)
  }

  clear(): number {
    const count = this.entries.length
    this.entries.length = 0
    this.totalBytes = 0
    return count
  }

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
