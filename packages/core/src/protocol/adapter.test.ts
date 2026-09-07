/** 验证 raw、JSON 和 custom adapter 的编码、分类与顺序保证。 */
import { describe, expect, it } from 'vitest'
import { createJsonProtocolAdapter, decodeAndClassify, rawProtocol, validateProtocolAdapter } from './adapter'
import { SocketFuseError } from '../shared/errors'

describe('protocol adapters', () => {
  it.each(['createPing', 'createPong', 'shouldReconnect'])('rejects malformed optional %s before opening', (key) => {
    expect(() => validateProtocolAdapter({ ...rawProtocol, [key]: 1 })).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })
  it('keeps raw data and classifies it as a business frame', () => {
    const value = new Uint8Array([1, 2, 3])
    expect(rawProtocol.encode(value, { messageId: 'm', now: 1 })).toBe(value)
    expect(rawProtocol.classify(value, { now: 1, receivedAt: 1 })).toEqual({ data: value, type: 'data' })
  })

  it('supports declarative JSON ignore, pong and path matchers', () => {
    const adapter = createJsonProtocolAdapter({
      heartbeat: {
        ping: { messageType: 'ping' },
        pong: { 'messageType': 'pong', 'meta.code': 200 },
        serverPing: { messageType: 'server-ping' },
        serverPong: { messageType: 'server-pong' },
      },
      ignore: [{ type: 'internal' }],
      type: 'json',
    })
    const context = { now: 1, receivedAt: 1 }
    expect(decodeAndClassify(adapter, JSON.stringify({ messageType: 'pong', meta: { code: 200 } }), context)).toEqual({ type: 'pong' })
    expect(decodeAndClassify(adapter, JSON.stringify({ type: 'internal' }), context)).toEqual({ type: 'ignore' })
    expect(decodeAndClassify(adapter, JSON.stringify({ value: 42 }), context)).toEqual({ data: { value: 42 }, type: 'data' })
    expect(adapter.encode({ event: 'business' }, { messageId: 'm', now: 1 })).toBe('{"event":"business"}')
    expect(adapter.createPing?.({ attempt: 1, now: 1 })).toEqual({ messageType: 'ping' })
  })

  it('maps malformed JSON to a stable decode error', () => {
    const adapter = createJsonProtocolAdapter({ type: 'json' })
    expect(() => decodeAndClassify(adapter, '{', { now: 1, receivedAt: 1 })).toThrowError(expect.objectContaining({ code: 'DECODE_FAILED' }))
    expect(() => createJsonProtocolAdapter({ type: 'json', ignore: [{ 'bad path': true }] })).toThrowError(SocketFuseError)
  })

  it('does not invent a server pong when the JSON protocol only classifies server ping', () => {
    const adapter = createJsonProtocolAdapter({
      heartbeat: {
        ping: { type: 'ping' },
        pong: { type: 'pong' },
        serverPing: { type: 'server-ping' },
      },
      type: 'json',
    })

    expect(decodeAndClassify(adapter, JSON.stringify({ type: 'server-ping' }), { now: 1, receivedAt: 1 })).toEqual({
      data: { type: 'server-ping' },
      type: 'ping',
    })
    expect(adapter.createPong).toBeUndefined()
  })
})
