import { describe, expect, it } from 'vitest'
import { DEFAULT_RECONNECT_OPTIONS } from './constants'
import { calculateReconnectDelay, ReconnectPolicy } from './reconnect'

describe('reconnect policy', () => {
  it('calculates bounded exponential jitter', () => {
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, jitter: 0 }, 1, () => 0)).toBe(1000)
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, jitter: 0 }, 4, () => 0)).toBe(8000)
    expect(calculateReconnectDelay({ ...DEFAULT_RECONNECT_OPTIONS, jitter: 0 }, 99, () => 0)).toBe(30_000)
  })

  it('resets attempts after the stable threshold', () => {
    const policy = new ReconnectPolicy({ ...DEFAULT_RECONNECT_OPTIONS, stableThreshold: 100 }, () => 0.5)
    policy.recordAttempt()
    policy.recordOpen(0)
    expect(policy.decide(99).attempt).toBe(2)
    expect(policy.decide(100).attempt).toBe(1)
  })
})
