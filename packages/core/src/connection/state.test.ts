/** 验证公开状态的 WebSocket 兼容映射。 */
import { describe, expect, it } from 'vitest'
import { readyStateFor, statusFor } from './state'

describe('connection status mapping', () => {
  it('maps browser-compatible state values', () => {
    expect(readyStateFor('connecting')).toBe(0)
    expect(readyStateFor('open')).toBe(1)
    expect(readyStateFor('closing')).toBe(2)
    expect(statusFor('failed')).toBe('CLOSED')
  })
})
