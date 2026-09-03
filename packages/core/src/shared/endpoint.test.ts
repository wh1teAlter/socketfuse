/** 验证共享 endpoint 校验的接受、拒绝与规范化边界。 */
import { describe, expect, it } from 'vitest'
import { MAX_ENDPOINT_LENGTH } from './constants'
import { normalizeEndpointUrl } from './endpoint'

describe('normalizeEndpointUrl', () => {
  it('returns the normalized href for absolute ws and wss urls', () => {
    expect(normalizeEndpointUrl('wss://example.test/socket', 'url')).toBe('wss://example.test/socket')
    expect(normalizeEndpointUrl('ws://example.test:8080/a?b=1', 'url')).toBe('ws://example.test:8080/a?b=1')
  })

  it('rejects non-string, relative, and non-ws protocols with INVALID_OPTIONS', () => {
    for (const value of [undefined, null, 42, {}])
      expect(() => normalizeEndpointUrl(value, 'url')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    expect(() => normalizeEndpointUrl('/relative', 'url')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
    expect(() => normalizeEndpointUrl('https://example.test', 'url')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('rejects urls longer than the endpoint limit before and after normalization', () => {
    const tooLong = `wss://example.test/${'a'.repeat(MAX_ENDPOINT_LENGTH)}`
    expect(() => normalizeEndpointUrl(tooLong, 'url')).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('uses the caller label in the message and only reports a field when asked', () => {
    expect(() => normalizeEndpointUrl('nope', 'Reconnect url')).toThrowError(/^Reconnect url /)
    const withField = (): string => normalizeEndpointUrl('nope', 'url', 'url')
    expect(withField).toThrowError(expect.objectContaining({ details: { field: 'url' } }))
    try {
      normalizeEndpointUrl('nope', 'url')
      expect.unreachable()
    }
    catch (error) {
      expect((error as { details?: unknown }).details).toBeUndefined()
    }
  })
})
