import { describe, expect, it } from 'vitest'
import { assertRevision, AuthRevisionRegister, EndpointRevisionRegister } from './revision'
import { WwsError } from './errors'

describe('revision registers', () => {
  it('applies newer auth revisions and rejects stale/equal values', () => {
    const register = new AuthRevisionRegister<string>()
    expect(register.update('one', 2)).toEqual({ revision: 2, status: 'applied' })
    expect(register.update('old', 2)).toEqual({ revision: 2, status: 'stale' })
    expect(register.update('old', 1)).toEqual({ revision: 2, status: 'stale' })
    expect(register.value).toBe('one')
  })

  it('makes endpoint equal revisions idempotent and conflicts on a different URL', () => {
    const register = new EndpointRevisionRegister('wss://example.test/one')
    expect(register.update('wss://example.test/one', 1)).toEqual({ revision: 1, status: 'applied' })
    expect(register.update('wss://example.test/one', 1)).toEqual({ revision: 1, status: 'unchanged' })
    expect(() => register.update('wss://example.test/two', 1)).toThrowError(WwsError)
    expect(register.update('wss://example.test/two', 2)).toEqual({ revision: 2, status: 'applied' })
  })

  it('validates positive revisions', () => {
    expect(() => assertRevision(0)).toThrowError(WwsError)
    expect(() => assertRevision(Number.POSITIVE_INFINITY)).toThrowError(WwsError)
  })
})
