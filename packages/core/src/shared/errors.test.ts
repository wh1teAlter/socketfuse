/** 验证公开错误不受应用异常文本、伪造错误码或附加秘密污染。 */
import { describe, expect, it } from 'vitest'
import { SocketFuseError, toSafePublicError, toSocketFuseError } from './errors'

describe('public errors', () => {
  it('maps an application SocketFuseError to the failing operation stage', () => {
    const supplied = Object.assign(new SocketFuseError('CLIENT_DISPOSED', { fatal: true }), { message: 'secret', details: { token: 'secret' }, cause: 'secret' })
    const actual = toSocketFuseError(supplied, 'DECODE_FAILED')
    expect(actual.code).toBe('DECODE_FAILED')
    expect(actual.fatal).toBe(false)
    expect(actual.message).not.toContain('secret')
    expect(actual).not.toHaveProperty('details')
    expect(actual).not.toHaveProperty('cause')
  })

  it('never exposes arbitrary text or metadata through the public constructor', () => {
    const actual = toSafePublicError(Object.assign(new SocketFuseError('PROTOCOL_ERROR'), { message: 'secret', details: { token: 'secret' }, cause: 'secret' }))
    expect(actual.message).not.toContain('secret')
    expect(actual).not.toHaveProperty('details')
    expect(actual).not.toHaveProperty('cause')
  })
})
