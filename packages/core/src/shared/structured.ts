import { invalidOptions } from './errors'

const objectTag = Object.prototype.toString

function encodeBytes(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes)
    result += byte.toString(16).padStart(2, '0')
  return result
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null)
    return 'null'

  switch (typeof value) {
    case 'string':
      return `string:${JSON.stringify(value)}`
    case 'boolean':
      return value ? 'boolean:true' : 'boolean:false'
    case 'number':
      if (Number.isNaN(value))
        return 'number:NaN'
      if (value === Number.POSITIVE_INFINITY)
        return 'number:Infinity'
      if (value === Number.NEGATIVE_INFINITY)
        return 'number:-Infinity'
      if (Object.is(value, -0))
        return 'number:-0'
      return `number:${value}`
    case 'undefined':
      return 'undefined'
    case 'bigint':
      return `bigint:${value}`
    case 'function':
    case 'symbol':
      throw invalidOptions('Configuration must contain structured-cloneable values')
  }

  if (seen.has(value))
    throw invalidOptions('Configuration must not contain circular references')
  seen.add(value)

  try {
    if (Array.isArray(value))
      return `array:[${value.map(item => serialize(item, seen)).join(',')}]`

    if (value instanceof Date)
      return `date:${value.toISOString()}`

    if (typeof Blob !== 'undefined' && value instanceof Blob)
      return `blob:${value.size}:${value.type}`

    if (value instanceof RegExp)
      return `regexp:${JSON.stringify(value.source)}/${value.flags}`

    if (value instanceof ArrayBuffer)
      return `arraybuffer:${encodeBytes(new Uint8Array(value))}`

    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      return `view:${value.constructor.name}:${encodeBytes(bytes)}`
    }

    if (value instanceof Map) {
      const entries = [...value.entries()].map(([key, entryValue]) => `${serialize(key, seen)}=>${serialize(entryValue, seen)}`)
      entries.sort()
      return `map:{${entries.join(',')}}`
    }

    if (value instanceof Set) {
      const entries = [...value.values()].map(entry => serialize(entry, seen))
      entries.sort()
      return `set:{${entries.join(',')}}`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw invalidOptions(`Unsupported configuration value ${objectTag.call(value)}`)

    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${serialize(record[key], seen)}`)
    return `object:{${entries.join(',')}}`
  }
  finally {
    seen.delete(value)
  }
}

export function stableSerialize(value: unknown): string {
  return serialize(value, new Set())
}

export function stableHash(value: unknown): string {
  const input = stableSerialize(value)
  let hash = 0x811C9DC5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `wws1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function assertStructuredCloneable(value: unknown, field: string): void {
  try {
    if (typeof structuredClone === 'function')
      structuredClone(value)
    else
      stableSerialize(value)
  }
  catch {
    throw invalidOptions(`${field} must be structured-cloneable`, field)
  }

  stableSerialize(value)
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Conservatively estimate the memory-relevant size of structured-clone data.
 * It is intentionally not a JSON estimate: binary values retain byteLength,
 * Maps/Sets are traversed, and repeated/cyclic references are bounded.
 */
export function estimateStructuredCloneBytes(value: unknown, limit: number = Number.POSITIVE_INFINITY): number {
  const encoder = new TextEncoder()
  const seen = new Set<object>()
  let total = 0

  const add = (bytes: number): void => {
    total += bytes
    if (total > limit)
      total = limit + 1
  }
  const textBytes = (text: string): number => encoder.encode(text).byteLength
  const visit = (current: unknown): void => {
    if (total > limit)
      return
    if (current === null || current === undefined) {
      add(1)
      return
    }
    switch (typeof current) {
      case 'boolean':
        add(1)
        return
      case 'number':
        add(8)
        return
      case 'bigint':
        add(8 + textBytes(current.toString()))
        return
      case 'string':
        add(4 + textBytes(current))
        return
      case 'symbol':
      case 'function':
        add(limit + 1)
        return
    }
    if (typeof current !== 'object')
      return
    if (seen.has(current)) {
      add(8)
      return
    }
    seen.add(current)
    try {
      if (typeof Blob !== 'undefined' && current instanceof Blob) {
        add(16 + current.size + textBytes(current.type))
        return
      }
      if (current instanceof ArrayBuffer) {
        add(16 + current.byteLength)
        return
      }
      if (ArrayBuffer.isView(current)) {
        add(24 + current.byteLength)
        return
      }
      if (current instanceof Date) {
        add(16)
        return
      }
      if (current instanceof RegExp) {
        add(16 + textBytes(current.source) + textBytes(current.flags))
        return
      }
      if (Array.isArray(current)) {
        add(16)
        for (const item of current)
          visit(item)
        return
      }
      if (current instanceof Map) {
        add(24)
        for (const [key, item] of current) {
          visit(key)
          visit(item)
        }
        return
      }
      if (current instanceof Set) {
        add(24)
        for (const item of current)
          visit(item)
        return
      }
      if (current instanceof Error) {
        add(limit + 1)
        return
      }
      const prototype = Object.getPrototypeOf(current)
      if (prototype !== Object.prototype && prototype !== null) {
        add(limit + 1)
        return
      }
      add(16)
      for (const key of Object.keys(current as Record<string, unknown>)) {
        add(textBytes(key))
        visit((current as Record<string, unknown>)[key])
      }
    }
    finally {
      // A repeated reference remains known; keeping it in `seen` is required
      // for both shared subgraphs and cycles.
    }
  }

  visit(value)
  return total
}
