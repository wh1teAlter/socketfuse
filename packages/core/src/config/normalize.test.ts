/** 验证创建选项默认值、共享 fingerprint 和冲突校验。 */
import { describe, expect, it } from 'vitest'
import { hasConfigConflict, normalizeWebSocketOptions } from './normalize'
import { SocketFuseError } from '../shared/errors'

describe('normalizeWebSocketOptions', () => {
  it('normalizes defaults and keeps lifecycle local', () => {
    const first = normalizeWebSocketOptions('wss://example.test/socket', { id: 'room' })
    const second = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'room',
      lifecycle: { restore: { replay: true } },
    })

    expect(first.shared.queue.whenDisconnected).toBe(false)
    expect(first.shared.reconnect).not.toBe(false)
    expect(first.local.lifecycle.enabled).toBe(false)
    expect(second.local.lifecycle.replay).toBe(true)
    expect(hasConfigConflict(first, second)).toBe(false)
    expect(first.configFingerprint).toBe(second.configFingerprint)
  })

  it('fingerprints shared fields independent of object key order', () => {
    const first = normalizeWebSocketOptions('wss://example.test/socket', {
      backpressure: { highWaterMarkBytes: 1000, lowWaterMarkBytes: 100 },
      id: 'room',
      queue: { maxBytes: 2000, maxMessages: 2, whenBackpressured: true, whenDisconnected: true },
    })
    const second = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'room',
      queue: { whenDisconnected: true, maxMessages: 2, whenBackpressured: true, maxBytes: 2000 },
      backpressure: { lowWaterMarkBytes: 100, highWaterMarkBytes: 1000 },
    })
    expect(first.configFingerprint).toBe(second.configFingerprint)
    expect(first.configCanonical).toBe(second.configCanonical)
  })

  it('rejects invalid values synchronously', () => {
    expect(() => normalizeWebSocketOptions('https://example.test', { id: 'room' })).toThrowError(SocketFuseError)
    expect(() => normalizeWebSocketOptions('wss://example.test', { id: '' })).toThrowError(SocketFuseError)
    expect(() => normalizeWebSocketOptions('wss://example.test', { id: 'room', queue: { maxMessages: 0 } })).toThrowError(SocketFuseError)
    expect(() => normalizeWebSocketOptions('wss://example.test', { id: 'room', autoReconnect: { jitter: 2 } })).toThrowError(SocketFuseError)
  })

  it('rejects heartbeat when the selected protocol does not support it', () => {
    expect(() => normalizeWebSocketOptions('wss://example.test', {
      heartbeat: true,
      id: 'room',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('detects shared config conflicts while allowing endpoint changes', () => {
    const first = normalizeWebSocketOptions('wss://example.test/a', { id: 'room' })
    const second = normalizeWebSocketOptions('wss://example.test/b', { id: 'room' })
    const third = normalizeWebSocketOptions('wss://example.test/a', { id: 'room', binaryType: 'blob' })
    expect(hasConfigConflict(first, second)).toBe(false)
    expect(hasConfigConflict(first, third)).toBe(true)
  })
})
