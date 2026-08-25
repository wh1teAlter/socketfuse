/** 验证 canonical 序列化、稳定 hash 和结构化克隆字节估算。 */
import { describe, expect, it } from 'vitest'
import { estimateStructuredCloneBytes } from './structured'

describe('estimateStructuredCloneBytes', () => {
  it('accounts for binary values nested in structured-clone containers', () => {
    const payload = {
      buffer: new ArrayBuffer(32),
      map: new Map([['binary', new Uint8Array(48)]]),
      set: new Set([new Uint16Array(16)]),
    }

    expect(estimateStructuredCloneBytes(payload)).toBeGreaterThanOrEqual(32 + 48 + 32)
  })

  it('bounds cyclic and unmeasurable values instead of treating them as free', () => {
    const cyclic: { self?: unknown } = {}
    cyclic.self = cyclic

    expect(estimateStructuredCloneBytes(cyclic, 64)).toBeLessThanOrEqual(64)
    expect(estimateStructuredCloneBytes(new Error('secret'), 64)).toBe(65)
  })

  it('stops above the supplied limit for a large ArrayBuffer', () => {
    expect(estimateStructuredCloneBytes(new ArrayBuffer(128), 64)).toBe(65)
  })
})
