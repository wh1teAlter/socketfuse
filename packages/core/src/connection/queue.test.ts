/** 验证有界出站 FIFO 队列的顺序、字节和 owner 清理。 */
import { describe, expect, it } from 'vitest'
import { SocketFuseError } from '../shared/errors'
import { OutboundQueue } from './queue'

describe('outboundQueue', () => {
  it('owns a compact binary snapshot after accepting a queued view', () => {
    const queue = new OutboundQueue(2, 8)
    const buffer = new ArrayBuffer(8192)
    const view = new Uint8Array(buffer, 4096, 1)
    view[0] = 7
    queue.enqueue('a', view, 'm1')
    view[0] = 99
    const actual = queue.peek()?.data as Uint8Array
    expect(actual[0]).toBe(7)
    expect(actual.buffer.byteLength).toBe(1)
    expect(queue.bytes).toBe(1)
  })
  it('is FIFO and tracks encoded bytes', () => {
    const queue = new OutboundQueue(2, 12)
    queue.enqueue('a', 'first', 'm1')
    queue.enqueue('b', 'second', 'm2')
    expect(queue.peek()?.messageId).toBe('m1')
    expect(queue.shift()?.ownerId).toBe('a')
    expect(queue.snapshot()).toEqual({ bytes: 6, messages: 1 })
  })

  it('enforces both message and byte limits without evicting entries', () => {
    const queue = new OutboundQueue(1, 4)
    queue.enqueue('a', 'one', 'm1')
    expect(() => queue.enqueue('a', 'two', 'm2')).toThrowError(SocketFuseError)
    expect(queue.size).toBe(1)
    queue.shift()
    expect(() => queue.enqueue('a', '12345', 'm3')).toThrowError(SocketFuseError)
  })

  it('removes only an owner or all entries as requested', () => {
    const queue = new OutboundQueue(5, 100)
    queue.enqueue('a', 'one', 'm1')
    queue.enqueue('b', 'two', 'm2')
    queue.enqueue('a', 'three', 'm3')
    expect(queue.removeOwner('a')).toBe(2)
    expect(queue.snapshot()).toEqual({ bytes: 3, messages: 1 })
    expect(queue.clear()).toBe(1)
    expect(queue.snapshot()).toEqual({ bytes: 0, messages: 0 })
  })
})
