/** 验证重连计数的预留/启动边界以及连续稳定窗口。 */
import { describe, expect, it } from 'vitest'
import { calculateReconnectDelay, ReconnectPolicy } from './reconnect'
import { DEFAULT_RECONNECT_OPTIONS } from '../shared/constants'

describe('reconnect budget', () => {
  it('clamps and rounds the final jittered delay including a zero-delay exponent overflow', () => {
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, jitter: 0 }, 1)).toBe(1000)
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, jitter: 1 }, 99, () => 1)).toBe(30_000)
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, initialDelay: 0 }, 10_000)).toBe(0)
    expect(Number.isInteger(calculateReconnectDelay(DEFAULT_RECONNECT_OPTIONS, 1, () => 0.123456))).toBe(true)
  })

  it('charges only started counted attempts and does not refill on exemptions or cancellation', () => {
    const budget = new ReconnectPolicy({ ...DEFAULT_RECONNECT_OPTIONS, maxRetries: 3, stableThreshold: false })
    budget.reserve(true)
    expect([budget.used, budget.remaining, budget.reserved]).toEqual([0, 2, 1])
    budget.cancel()
    expect(budget.remaining).toBe(3)
    for (let index = 0; index < 3; index++) {
      budget.reserve(true)
      budget.start(true)
      budget.reserve(false)
      budget.start(false)
      expect(budget.used).toBe(index + 1)
    }
    expect(() => budget.reserve(true)).toThrowError(expect.objectContaining({ code: 'RETRY_EXHAUSTED' }))
    budget.reserve(false)
    budget.start(false)
    expect([budget.used, budget.remaining]).toEqual([3, 0])
  })

  it('never counts disconnected time as a stable connection', () => {
    const budget = new ReconnectPolicy({ ...DEFAULT_RECONNECT_OPTIONS, stableThreshold: 100 })
    budget.reserve(true)
    budget.start(true)
    budget.recordOpen(0)
    budget.endOpen(99)
    expect(budget.settleStable(1000)).toBe(false)
    expect(budget.used).toBe(1)
    budget.recordOpen(1000)
    expect(budget.settleStable(1100)).toBe(true)
    expect(budget.used).toBe(0)
  })

  it('cannot reset a new reservation after the old open window was sealed', () => {
    const budget = new ReconnectPolicy({ ...DEFAULT_RECONNECT_OPTIONS, stableThreshold: 100 })
    budget.recordOpen(0)
    budget.settleStable(50)
    budget.reserve(true)
    budget.endOpen(50)
    expect(budget.settleStable(200)).toBe(false)
    expect(budget.reserved).toBe(1)
  })
})
