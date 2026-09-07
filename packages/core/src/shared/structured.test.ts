/** 验证 canonical 序列化、稳定 hash 和结构化克隆字节估算。 */
import { describe, expect, it } from 'vitest'
import { estimatePayloadBytes, estimateStructuredCloneBytes } from './structured'

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

  it('charges the backing buffer of a tiny view and counts shared backing only once', () => {
    const buffer = new ArrayBuffer(8192)
    const view = new Uint8Array(buffer, 4000, 1)
    expect(estimateStructuredCloneBytes(view, 4096)).toBeGreaterThan(4096)
    expect(estimateStructuredCloneBytes([view, new DataView(buffer, 0, 1)], 9000)).toBeLessThan(9000)
    expect(estimateStructuredCloneBytes([view, new DataView(buffer, 0, 1)], 9000)).toBeGreaterThan(8192)
  })

  it('rejects accessors without invoking them, shared buffers, and excessive depth', () => {
    let reads = 0
    const accessor = Object.defineProperty({}, 'data', { enumerable: true, get: () => ++reads })
    expect(estimateStructuredCloneBytes(accessor, 1024)).toBeGreaterThan(1024)
    expect(reads).toBe(0)
    expect(estimateStructuredCloneBytes(new Uint8Array(new SharedArrayBuffer(1)), 1024)).toBeGreaterThan(1024)
    let nested: unknown = null
    for (let index = 0; index < 1000; index++)
      nested = { nested }
    expect(estimateStructuredCloneBytes(nested, 100_000)).toBeGreaterThan(100_000)
  })
})

describe('estimatePayloadBytes', () => {
  it('measures cloneable values whose prototype is not Object.prototype', () => {
    class Order {
      constructor(readonly orderId: string) {}
    }

    expect(estimatePayloadBytes(new Order('a'), 4096)).toBeLessThanOrEqual(4096)
    expect(estimatePayloadBytes({ list: [new Order('a')] }, 4096)).toBeLessThanOrEqual(4096)
    expect(estimatePayloadBytes(new Map([['k', new Order('a')]]), 4096)).toBeLessThanOrEqual(4096)
    expect(estimatePayloadBytes(new Error('boom'), 4096)).toBeLessThanOrEqual(4096)
  })

  it('still reports values that structuredClone cannot carry as over the limit', () => {
    expect(estimatePayloadBytes(() => 1, 4096)).toBeGreaterThan(4096)
    expect(estimatePayloadBytes(Symbol('s'), 4096)).toBeGreaterThan(4096)
    expect(estimatePayloadBytes(new ArrayBuffer(8192), 4096)).toBeGreaterThan(4096)
  })
})
