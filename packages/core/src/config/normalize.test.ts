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
    expect(() => normalizeWebSocketOptions('wss://example.test', { id: 'room', reconnect: { jitter: 2 } })).toThrowError(SocketFuseError)
  })

  it('supports raw string heartbeat without enabling timeout implicitly', () => {
    const config = normalizeWebSocketOptions('wss://example.test', {
      heartbeat: true,
      id: 'room',
    })
    expect(config.shared.heartbeat).toMatchObject({ message: 'ping', responseMessage: 'pong' })
    expect(config.shared.heartbeat && config.shared.heartbeat.pongTimeout).toBeUndefined()
  })

  it('fingerprints raw binary heartbeat bytes and rejects Blob heartbeat config', () => {
    const first = normalizeWebSocketOptions('wss://example.test', {
      heartbeat: { message: new Uint8Array([1]), responseMessage: new Uint8Array([2]) },
      id: 'binary-heartbeat',
    })
    const second = normalizeWebSocketOptions('wss://example.test', {
      heartbeat: { message: new Uint8Array([3]), responseMessage: new Uint8Array([2]) },
      id: 'binary-heartbeat',
    })

    expect(hasConfigConflict(first, second)).toBe(true)
    expect(() => normalizeWebSocketOptions('wss://example.test', {
      heartbeat: { message: new Blob(['ping']) as unknown as string },
      id: 'blob-heartbeat',
    })).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('rejects URL objects and obsolete function-based custom protocol options', () => {
    expect(() => normalizeWebSocketOptions(new URL('wss://example.test') as unknown as string, { id: 'fixed-string-only' })).toThrowError(SocketFuseError)
    expect(() => normalizeWebSocketOptions('wss://example.test', {
      heartbeat: true,
      id: 'missing-create-ping',
      protocol: {
        // @ts-expect-error 旧版页面函数协议必须在运行时拒绝。
        classify: (data: unknown) => ({ data, type: 'data' }),
        decode: (data: unknown) => data,
        encode: (data: unknown) => String(data),
        id: 'missing-create-ping',
        version: 1,
      },
      worker: () => null as unknown as SharedWorker,
    })).toThrowError(SocketFuseError)
  })

  it('keeps raw heartbeat payloads out of JSON and custom timing config', () => {
    const json = normalizeWebSocketOptions('wss://example.test', {
      heartbeat: true,
      id: 'json-heartbeat',
      protocol: {
        heartbeat: { ping: { messageType: 'ping' }, pong: { messageType: 'pong' } },
        type: 'json',
      },
    })
    expect(json.shared.heartbeat).toEqual({ interval: 25_000, mode: 'pong' })
    expect(() => normalizeWebSocketOptions('wss://example.test', {
      heartbeat: { message: 'raw-ping' },
      id: 'invalid-json-heartbeat',
      protocol: {
        heartbeat: { ping: { messageType: 'ping' }, pong: { messageType: 'pong' } },
        type: 'json',
      },
    })).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('detects shared config conflicts while allowing endpoint changes', () => {
    const first = normalizeWebSocketOptions('wss://example.test/a', { id: 'room' })
    const second = normalizeWebSocketOptions('wss://example.test/b', { id: 'room' })
    const third = normalizeWebSocketOptions('wss://example.test/a', { id: 'room', binaryType: 'blob' })
    expect(hasConfigConflict(first, second)).toBe(false)
    expect(hasConfigConflict(first, third)).toBe(false)
  })
})
