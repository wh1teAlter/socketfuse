/** 验证应用层 heartbeat 的可选超时、activity 确认与单待决约束。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeartbeatController } from './heartbeat'

afterEach(() => vi.useRealTimers())

describe('heartbeat controller', () => {
  it('keeps sending without creating a timeout when pongTimeout is absent', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const onTimeout = vi.fn()
    const heartbeat = new HeartbeatController({
      interval: 100,
      message: 'ping',
      mode: 'pong',
      responseMessage: 'pong',
    }, { onTimeout, send })

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(300)

    expect(send).toHaveBeenCalledTimes(3)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(heartbeat.waitingForResponse).toBe(false)
  })

  it('uses activity as the configured acknowledgement without overlapping waits', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const onTimeout = vi.fn()
    const heartbeat = new HeartbeatController({
      interval: 100,
      message: 'ping',
      mode: 'activity',
      pongTimeout: 250,
      responseMessage: 'pong',
    }, { onTimeout, send })

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(200)
    expect(send).toHaveBeenCalledTimes(1)
    heartbeat.acknowledge('activity')
    await vi.advanceTimersByTimeAsync(100)
    expect(send).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(249)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onTimeout).toHaveBeenCalledTimes(1)
  })

  it('clears both timers on stop and ignores repeated or late acknowledgements', async () => {
    vi.useFakeTimers()
    const send = vi.fn()
    const onTimeout = vi.fn()
    const heartbeat = new HeartbeatController({
      interval: 100,
      mode: 'pong',
      pongTimeout: 50,
    }, { onTimeout, send })

    heartbeat.start()
    await vi.advanceTimersByTimeAsync(100)
    heartbeat.acknowledge('pong')
    heartbeat.acknowledge('pong')
    heartbeat.stop()
    heartbeat.acknowledge('pong')
    await vi.advanceTimersByTimeAsync(500)

    expect(send).toHaveBeenCalledTimes(1)
    expect(onTimeout).not.toHaveBeenCalled()
    expect(heartbeat.waitingForResponse).toBe(false)
  })
})
