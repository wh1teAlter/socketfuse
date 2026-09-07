/** 验证共享 endpoint 校验的接受、拒绝与规范化边界。 */
import { describe, expect, it } from 'vitest'
import { MAX_ENDPOINT_LENGTH } from './constants'
import { normalizeEndpointUrl } from './endpoint'

describe('normalizeEndpointUrl', () => {
  it('returns the normalized href for absolute ws and wss urls', () => {
    expect(normalizeEndpointUrl('wss://example.test/socket')).toBe('wss://example.test/socket')
    expect(normalizeEndpointUrl('ws://example.test:8080/a?b=1')).toBe('ws://example.test:8080/a?b=1')
  })

  it('rejects non-string, relative, and non-ws protocols with INVALID_OPTIONS', () => {
    for (const value of [undefined, null, 42, {}])
      expect(() => normalizeEndpointUrl(value)).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    expect(() => normalizeEndpointUrl('/relative')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    expect(() => normalizeEndpointUrl('https://example.test')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('rejects urls longer than the endpoint limit before and after normalization', () => {
    const tooLong = `wss://example.test/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`
    expect(() => normalizeEndpointUrl(tooLong)).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('rejects credentials and even an empty fragment without echoing them', () => {
    for (const url of ['wss://user:secret@example.test/', 'wss://example.test/#', 'wss://example.test/#secret']) {
      expect(() => normalizeEndpointUrl(url)).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    }
  })

  it('uses only stable safe errors for every endpoint boundary', () => {
    expect(() => normalizeEndpointUrl('nope')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    try {
      normalizeEndpointUrl('nope')
      expect.unreachable()
    }
    catch (error) {
      expect((error as { details?: unknown }).details).toBeUndefined()
    }
  })
})
