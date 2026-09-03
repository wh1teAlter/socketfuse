/**
 * 为共享配置、控制消息与回放边界提供确定性序列化和保守的结构化克隆字节估算。
 *
 * 控制面必须宁可拒绝循环或无法可靠估算的值，也不能把它们当作零成本数据；否则
 * 单个同源页面能绕过 Worker 的内存和 envelope 限制。
 */
import { invalidOptions } from './errors'

/** 用于识别不受支持对象原型的原生标签函数。 */
const objectTag = Object.prototype.toString

/** 将二进制值编码成稳定字符串，供 canonical 序列化使用。 */
function encodeBytes(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes)
    result += byte.toString(16).padStart(2, '0')
  return result
}

/**
 * 递归生成对象的确定性文本表示。
 *
 * 键排序和容器类型标签使等价共享配置得到相同 fingerprint；循环引用必须失败，
 * 因为其既无法安全跨端口，也无法定义稳定有限的配置身份。
 */
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
      throw invalidOptions('Blob contents cannot participate in a synchronous configuration fingerprint')

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

/**
 * 将支持的结构化克隆值序列化为键顺序稳定的文本。
 *
 * @param value 用于共享配置 fingerprint 或安全诊断的值。
 * @returns 可重复比较的 canonical 字符串。
 * @throws `INVALID_OPTIONS`，当值循环、不可克隆或不可稳定表示时。
 */
export function stableSerialize(value: unknown): string {
  return serialize(value, new Set())
}

/**
 * 生成紧凑稳定的非秘密诊断 hash。
 *
 * @param value 将先按 stableSerialize 规范化的值。
 * @returns 十六进制 FNV-1a hash；仅用于关联诊断，不能作为安全或授权用途。
 */
export function stableHash(value: unknown): string {
  const input = stableSerialize(value)
  let hash = 0x811C9DC5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `socketfuse1-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

/**
 * 确保一个值可跨 Worker 边界并能形成确定性 canonical。
 *
 * @param value 待验证的共享配置或控制字段。
 * @param field 用于本地校验错误的字段路径。
 * @throws `INVALID_OPTIONS`，当值不能结构化克隆或含循环引用时。
 */
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

/**
 * 判断值是否为普通对象记录。
 *
 * @param value 待验证的未知控制字段。
 * @returns 仅当原型为 `Object.prototype` 或 `null` 时返回 `true`。
 */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 保守估算结构化克隆 payload 的内存相关字节数。
 *
 * 它不是 JSON 估算：二进制值保留 byteLength，Map/Set 会遍历，重复/循环引用有界。
 * 不支持的值会视为超限，避免畸形控制消息因被当作“零成本”而绕过 Worker 限制。
 *
 * @param value 待发送或缓存的结构化克隆值。
 * @param limit 到达此字节数后可提前终止的上限；默认不设上限。
 * @returns 保守估算的字节数；无法估算时返回大于 limit 的值。
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
