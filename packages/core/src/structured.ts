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
