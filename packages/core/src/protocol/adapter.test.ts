/** 验证 raw、JSON 和 custom adapter 的编码、分类与顺序保证。 */
import { describe, expect, it } from 'vitest'
import { createJsonProtocolAdapter, decodeAndClassify, rawProtocol } from './adapter'
import { SocketFuseError } from '../shared/errors'

describe('protocol adapters', () => {
  it('keeps raw data and classifies it as a business frame', () => {
    const value = new Uint8Array([1, 2, 3])
    expect(rawProtocol.encode(value, { messageId: 'm', now: 1 })).toBe(value)
    expect(rawProtocol.classify(value, { now: 1, receivedAt: 1 })).toEqual({ data: value, type: 'data' })
  })

  it('supports declarative JSON ready, ignore, pong and path matchers', async () => {
    const adapter = createJsonProtocolAdapter({
      heartbeat: {
        ping: { type: 'ping' },
        pong: { 'type': 'pong', 'meta.code': 200 },
        serverPing: { type: 'server-ping' },
        serverPong: { type: 'server-pong' },
      },
      auth: { template: { auth: '$auth' } },
      ignore: [{ type: 'internal' }],
      ready: { status: 'ready' },
      type: 'json',
    })
    const context = { now: 1, receivedAt: 1 }
    await expect(decodeAndClassify(adapter, JSON.stringify({ status: 'ready' }), context)).resolves.toEqual({ type: 'ready' })
    await expect(decodeAndClassify(adapter, JSON.stringify({ type: 'pong', meta: { code: 200 } }), context)).resolves.toEqual({ type: 'pong' })
    await expect(decodeAndClassify(adapter, JSON.stringify({ type: 'internal' }), context)).resolves.toEqual({ type: 'ignore' })
    await expect(decodeAndClassify(adapter, JSON.stringify({ value: 42 }), context)).resolves.toEqual({ data: { value: 42 }, type: 'data' })
    expect(adapter.encode({ auth: '$auth' }, { messageId: 'm', now: 1 })).toBe('{"auth":"$auth"}')
    expect(adapter.createAuth?.({ token: 'secret' }, { now: 1, revision: 1 })).toEqual({ auth: { token: 'secret' } })
  })

  it('maps malformed JSON to a stable decode error', async () => {
    const adapter = createJsonProtocolAdapter({ type: 'json' })
    await expect(decodeAndClassify(adapter, '{', { now: 1, receivedAt: 1 })).rejects.toMatchObject({ code: 'DECODE_FAILED' })
    expect(() => createJsonProtocolAdapter({ type: 'json', ready: { 'bad path': true } })).toThrowError(SocketFuseError)
  })
})
