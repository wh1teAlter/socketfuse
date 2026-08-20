import { describe, expect, it } from 'vitest'
import { BackpressureTracker } from './backpressure'

describe('backpressureTracker', () => {
  it('uses high/low hysteresis', () => {
    const tracker = new BackpressureTracker({ highWaterMarkBytes: 100, lowWaterMarkBytes: 25 })
    expect(tracker.update(100)).toBe(true)
    expect(tracker.update(50)).toBe(true)
    expect(tracker.update(25)).toBe(false)
    expect(tracker.isHighWater).toBe(false)
  })
})
