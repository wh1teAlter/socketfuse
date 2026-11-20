/** 验证回放容量和投递 credit 的独立计费、FIFO 及授权抑制。 */
import { describe, expect, it } from 'vitest'
import type { WorkerControlMessage } from './control'
import { DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { ParticipantDelivery } from './delivery'

/** 构造可手动归还 credit 的单参与期投递器。 */
function delivery(maxBytes = 20) {
  const messages: WorkerControlMessage[] = []
  const instance = new ParticipantDelivery('session', 'epoch', { enabled: true, replay: true, maxBytes, maxMessages: 3 }, { ...DEFAULT_WORKER_RESOURCE_LIMITS, maxDeliveryMessages: 1 }, (message) => {
    messages.push(message)
    return true
  })
  return { instance, messages, frames: () => messages.filter(message => message.type === 'message') }
}

describe('participant delivery', () => {
  it('drops an oversized new replay item without evicting retained older data', () => {
    const { instance, frames, messages } = delivery(10)
    instance.suspend()
    instance.deliver('ok', 1, [])
    instance.deliver('too large to retain', 2, [])
    instance.resume()
    expect(frames().map(frame => frame.data)).toEqual(['ok'])
    expect(messages.find(message => message.type === 'overflow')).toMatchObject({ direction: 'replay', strategy: 'drop-newest' })
  })
  it('reports replay eviction separately from rejecting an oversized new item', () => {
    const { instance, messages } = delivery(10)
    instance.suspend()
    instance.deliver('old', 1, [])
    instance.deliver('replacement', 2, [])
    instance.deliver('next', 3, [])
    instance.resume()
    expect(messages.filter(message => message.type === 'overflow')).toMatchObject([
      { strategy: 'drop-newest', droppedMessages: 1 },
      { strategy: 'drop-oldest', droppedMessages: 1 },
    ])
  })
  it('retains a FIFO replay head without credit and appends new data behind it', () => {
    const { instance, frames } = delivery()
    instance.deliver('first', 1, [])
    instance.suspend()
    instance.deliver('old', 2, [{ key: 'effect', generation: 1 }])
    instance.resume()
    instance.deliver('new', 3, [])
    expect(frames()).toHaveLength(1)
    instance.receipt(1)
    expect(frames().map(frame => frame.data)).toEqual(['first', 'old'])
    instance.receipt(2)
    expect(frames().map(frame => frame.data)).toEqual(['first', 'old', 'new'])
    expect(frames()[1]).toMatchObject({ replayed: true, dispatch: [], receivedAt: 2 })
  })
  it('does not allow repeated or unknown receipts to increase credit and bounds overflow notifications', () => {
    const { instance, frames, messages } = delivery()
    instance.deliver('one', 1, [])
    instance.receipt(999)
    for (let index = 0; index < 100; index++) instance.deliver('drop', 2, [])
    expect(frames()).toHaveLength(1)
    expect(messages.filter(message => message.type === 'overflow')).toHaveLength(1)
    instance.receipt(1)
    instance.deliver('two', 3, [])
    instance.receipt(1)
    instance.deliver('three', 4, [])
    expect(frames().map(frame => frame.data)).toEqual(['one', 'two'])
    instance.dispose()
    instance.receipt(2)
    instance.deliver('late', 5, [])
    expect(frames()).toHaveLength(2)
  })
  it('replays a delivery the paused page returned ahead of data buffered after it', () => {
    const { instance, frames } = delivery()
    instance.deliver('early', 1, [{ key: 'effect', generation: 1 }])
    instance.suspend()
    instance.deliver('late', 2, [])
    instance.receipt(1, true)
    instance.resume()
    expect(frames().map(frame => frame.data)).toEqual(['early', 'early'])
    expect(frames()[1]).toMatchObject({ replayed: true, dispatch: [], receivedAt: 1 })
    instance.receipt(2)
    expect(frames().map(frame => frame.data)).toEqual(['early', 'early', 'late'])
  })
  it('drops a returned delivery as the oldest item when the replay buffer is full', () => {
    const { instance, frames, messages } = delivery(10)
    instance.deliver('old', 1, [])
    instance.suspend()
    instance.deliver('next', 2, [])
    instance.receipt(1, true)
    instance.resume()
    expect(frames().map(frame => frame.data)).toEqual(['old', 'next'])
    expect(messages.find(message => message.type === 'overflow')).toMatchObject({ direction: 'replay', strategy: 'drop-oldest', droppedMessages: 1 })
  })
})
