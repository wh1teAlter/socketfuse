/** 验证重连计划候选的可见性、FIFO、超时转移与代际拒绝。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReconnectCoordinator } from './reconnect-coordinator'

afterEach(() => vi.useRealTimers())

describe('reconnect coordinator', () => {
  it('uses one total deadline instead of resetting timeout for each candidate', async () => {
    vi.useFakeTimers()
    const assigned: string[] = []
    const aborted: string[] = []
    const committed: unknown[] = []
    const coordinator = new ReconnectCoordinator({
      onAbort: client => aborted.push(client),
      onAssign: client => assigned.push(client),
      onCommit: (_plan, override) => committed.push(override),
      timeout: 100,
    })
    coordinator.register('hidden', 'hidden')
    coordinator.register('visible', 'visible')
    coordinator.start({ attempt: 1, close: { code: 1006, terminal: false, wasClean: false }, defaultDelay: 1000, id: 'plan', reason: 'socket-close' })
    expect(assigned).toEqual(['visible'])
    coordinator.reject('visible', 'plan')
    expect(assigned).toEqual(['visible', 'hidden'])
    await vi.advanceTimersByTimeAsync(100)
    expect(aborted).toEqual(['hidden'])
    expect(committed).toEqual([{}])
    expect(() => coordinator.accept('hidden', 'plan', { delay: 0 })).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
  })
})
