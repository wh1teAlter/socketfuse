/** 验证连接状态迁移图与 WebSocket 兼容状态映射。 */
import { describe, expect, it } from 'vitest'
import { ConnectionStateMachine, readyStateFor, statusFor } from './state'
import { WwsError } from '../shared/errors'

describe('connection state machine', () => {
  it('accepts the physical connection lifecycle', () => {
    const machine = new ConnectionStateMachine()
    machine.transition('connecting')
    machine.transition('handshaking')
    machine.transition('open')
    machine.transition('reconnecting')
    machine.transition('connecting')
    expect(machine.state).toBe('connecting')
  })

  it('rejects illegal transitions with INTERNAL_STATE_ERROR', () => {
    const machine = new ConnectionStateMachine()
    expect(() => machine.transition('open')).toThrowError(WwsError)
    expect(() => machine.transition('open')).toThrowError(/Invalid connection transition/)
  })

  it('maps browser-compatible state values', () => {
    expect(readyStateFor('handshaking')).toBe(0)
    expect(readyStateFor('open')).toBe(1)
    expect(readyStateFor('closing')).toBe(2)
    expect(statusFor('failed')).toBe('CLOSED')
  })
})
