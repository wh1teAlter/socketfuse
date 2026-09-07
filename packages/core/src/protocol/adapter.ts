/**
 * 定义 raw、声明式 JSON 与 custom Worker 协议适配器，并把原始 WebSocket payload
 * 分类为业务帧或控制帧。适配器只在拥有它的运行时执行，不能通过 MessagePort 传递函数。
 */
import type {
  ClassifyContext,
  DecodeContext,
  EncodeContext,
  HeartbeatContext,
  JsonMatcher,
  JsonProtocolOptions,
  JsonValue,
  ProtocolAdapter,
  ProtocolFrame,
  SocketData,
} from '../shared/types'
import { assertStructuredCloneable, isPlainRecord, stableSerialize } from '../shared/structured'
import { invalidOptions, SocketFuseError } from '../shared/errors'
import { invokeSynchronous } from '../shared/callbacks'
import { socketDataByteLength } from '../shared/bytes'

/** custom adapter id 的稳定命名约束。 */
const adapterIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

/**
 * 判断 custom adapter id 是否符合稳定命名约束。
 *
 * @param value 待校验的 adapter id。
 * @returns 符合命名约束时返回 `true`。
 */
export function isValidAdapterId(value: string): boolean {
  return adapterIdPattern.test(value)
}

/** raw 协议：原样透传 WebSocket payload，不增加应用协议状态。 */
export const rawProtocol: ProtocolAdapter<SocketData, SocketData> = Object.freeze({
  /** 将 raw 入站 payload 作为业务 data。 */
  classify(data: SocketData): ProtocolFrame<SocketData> {
    return { data, type: 'data' }
  },
  /** raw 协议不改变入站 payload。 */
  decode(data: SocketData): SocketData {
    return data
  },
  /** raw 协议不改变出站 payload。 */
  encode(data: SocketData): SocketData {
    return data
  },
  id: 'raw',
  version: 1,
})

/** 判断值是否为无循环的 JSON 结构。 */
function isJsonValue(value: unknown, seen = new Set<object>(), depth = 0): value is JsonValue {
  if (depth > 64)
    return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (typeof value !== 'object')
    return false
  if (seen.has(value))
    return false
  seen.add(value)
  try {
    if (Array.isArray(value))
      return value.every(item => isJsonValue(item, seen, depth + 1))
    if (!isPlainRecord(value))
      return false
    return Object.values(value).every(item => isJsonValue(item, seen, depth + 1))
  }
  finally {
    seen.delete(value)
  }
}

/** 将 matcher 点号/下标路径解析为访问片段。 */
function pathSegments(path: string): (string | number)[] {
  if (path.length === 0)
    throw invalidOptions()
  const segments: (string | number)[] = []
  const pattern = /([A-Z_$][\w$-]*|\[(\d+)\])/gi
  let offset = 0
  for (const match of path.matchAll(pattern)) {
    if (match.index !== offset && !(offset === 0 && match.index === 0))
      throw invalidOptions()
    const token = match[1]
    if (token === undefined)
      throw invalidOptions()
    segments.push(match[2] === undefined ? token : Number(match[2]))
    offset = match.index + match[0].length
    if (path[offset] === '.')
      offset++
  }
  if (offset !== path.length || segments.length === 0)
    throw invalidOptions()
  return segments
}

/** 按已校验路径读取 JSON 值；中间节点不存在时返回 undefined。 */
function getPath(value: unknown, path: string): unknown {
  let current: unknown = value
  for (const segment of pathSegments(path)) {
    if (current === null || typeof current !== 'object')
      return undefined
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

/** 使用稳定序列化比较 matcher 的字段值，避免对象键序差异。 */
function matches(value: unknown, matcher: JsonMatcher): boolean {
  return Object.entries(matcher).every(([path, expected]) => stableSerialize(getPath(value, path)) === stableSerialize(expected))
}

/** 校验 JSON matcher 的路径和期望值。 */
function validateMatcher(matcher: unknown): asserts matcher is JsonMatcher {
  if (!isPlainRecord(matcher) || !Object.entries(matcher).every(([path, expected]) => {
    pathSegments(path)
    return isJsonValue(expected)
  })) {
    throw invalidOptions()
  }
}

/** 同步解析原生文本或 ArrayBuffer 入站；Blob 仅可在页面表示层产生。 */
function readJson(data: SocketData): JsonValue {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data)
      if (!isJsonValue(parsed))
        throw new Error('not JSON value')
      return parsed
    }
    catch {
      throw new SocketFuseError('DECODE_FAILED')
    }
  }
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data))
    throw new SocketFuseError('DECODE_FAILED')
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return readJson(new TextDecoder().decode(bytes))
  }
  catch {
    throw new SocketFuseError('DECODE_FAILED')
  }
}

/** 在创建适配器前校验 JSON 协议的可克隆性和 matcher 约束。 */
function validateJsonOptions(options: JsonProtocolOptions): void {
  if (options.type !== 'json')
    throw invalidOptions()
  if (options.ignore !== undefined) {
    if (!Array.isArray(options.ignore))
      throw invalidOptions()
    options.ignore.forEach(matcher => validateMatcher(matcher))
  }
  if (options.heartbeat !== undefined) {
    if (!isPlainRecord(options.heartbeat) || !('ping' in options.heartbeat) || !('pong' in options.heartbeat))
      throw invalidOptions()
    if (!isJsonValue(options.heartbeat.ping) || !isJsonValue(options.heartbeat.serverPong ?? null))
      throw invalidOptions()
    validateMatcher(options.heartbeat.pong)
    if (options.heartbeat.serverPing !== undefined)
      validateMatcher(options.heartbeat.serverPing)
    assertStructuredCloneable(options.heartbeat)
  }
  assertStructuredCloneable(options)
}

/** 创建同步声明式 JSON 适配器，失败统一使用安全阶段错误。 */
export function createJsonProtocolAdapter(options: JsonProtocolOptions): ProtocolAdapter<JsonValue, JsonValue> {
  validateJsonOptions(options)
  const snapshot = structuredClone(options)
  const ignore = snapshot.ignore ?? []
  const heartbeat = snapshot.heartbeat
  const serverPong = heartbeat?.serverPong
  const descriptorConfig = Object.freeze(structuredClone(snapshot) as unknown as Record<string, unknown>)

  return Object.freeze({
    /** 识别 heartbeat、ignore 与业务帧。 */
    classify(data: JsonValue): ProtocolFrame<JsonValue> {
      if (heartbeat !== undefined && matches(data, heartbeat.pong))
        return { type: 'pong' }
      if (heartbeat?.serverPing !== undefined && matches(data, heartbeat.serverPing))
        return { data, type: 'ping' }
      if (ignore.some(matcher => matches(data, matcher)))
        return { type: 'ignore' }
      return { data, type: 'data' }
    },
    ...(heartbeat === undefined
      ? {}
      : {
          /** 返回声明式 JSON ping 模板。 */
          createPing(context: HeartbeatContext): JsonValue {
            void context
            return heartbeat.ping
          },
        }),
    ...(serverPong === undefined
      ? {}
      : {
          /** 返回声明式 JSON server-pong 模板。 */
          createPong(ping: ProtocolFrame<JsonValue>, context: HeartbeatContext): JsonValue {
            void ping
            void context
            return serverPong
          },
        }),
    /** 将原始 payload 解码为 JSON 值。 */
    decode(data: SocketData, context: DecodeContext): JsonValue {
      void context
      return readJson(data)
    },
    /** 将 JSON 值编码为字符串 payload。 */
    encode(data: JsonValue, context: EncodeContext): string {
      void context
      try {
        if (!isJsonValue(data))
          throw new Error('Value is not JSON-compatible')
        return JSON.stringify(data)
      }
      catch {
        throw new SocketFuseError('ENCODE_FAILED')
      }
    },
    id: 'json',
    sharedConfig: descriptorConfig,
    version: 1,
  })
}

/** 将 raw/JSON 选择转换为参与共享冲突判断的协议描述。 */
export function getProtocolDescriptor(protocol: 'raw' | JsonProtocolOptions): {
  readonly kind: 'raw' | 'json'
  readonly id: string
  readonly version: number
  readonly sharedConfig: Readonly<Record<string, unknown>>
} {
  if (protocol === 'raw')
    return Object.freeze({ id: 'raw', kind: 'raw', sharedConfig: {}, version: 1 })
  const adapter = createJsonProtocolAdapter(protocol)
  return Object.freeze({ id: adapter.id, kind: 'json', sharedConfig: adapter.sharedConfig ?? {}, version: adapter.version })
}

/** 校验 custom adapter 的跨 Worker 注册形状。 */
export function validateProtocolAdapter(value: unknown): asserts value is ProtocolAdapter<unknown, unknown> {
  if (!isPlainRecord(value)
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(property => !('value' in property))
    || typeof value.id !== 'string'
    || !isValidAdapterId(value.id)
    || typeof value.version !== 'number'
    || !Number.isSafeInteger(value.version)
    || value.version <= 0
    || typeof value.encode !== 'function'
    || typeof value.decode !== 'function'
    || typeof value.classify !== 'function') {
    throw invalidOptions()
  }
  for (const key of ['createPing', 'createPong', 'shouldReconnect'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'function')
      throw invalidOptions()
  }
}

/** 调用同步 adapter 编码并校验其原生 wire 返回值；不允许 Promise 队尾。 */
export function encodeWithAdapter<Incoming, Outgoing>(
  adapter: ProtocolAdapter<Incoming, Outgoing>,
  data: Outgoing,
  context: EncodeContext,
): SocketData {
  const encoded = invokeSynchronous(() => adapter.encode(data, context), 'ENCODE_FAILED')
  try {
    socketDataByteLength(encoded)
    return encoded
  }
  catch {
    throw new SocketFuseError('ENCODE_FAILED')
  }
}

/** 同步解码与分类；回调与返回结构分别校验，不保留应用伪造的错误码。 */
export function decodeAndClassify<Incoming, Outgoing>(
  adapter: ProtocolAdapter<Incoming, Outgoing>,
  data: SocketData,
  context: DecodeContext & ClassifyContext,
): ProtocolFrame<Incoming> {
  const decoded = invokeSynchronous(() => adapter.decode(data, context), 'DECODE_FAILED')
  const frame = invokeSynchronous(() => adapter.classify(decoded, context), 'PROTOCOL_ERROR')
  try {
    if (!isPlainRecord(frame))
      throw new Error()
    const keys = Object.keys(frame)
    if (frame.type === 'data' || frame.type === 'control' || frame.type === 'ping') {
      if (keys.length !== 2 || !Object.hasOwn(frame, 'data'))
        throw new Error()
    }
    else if (frame.type === 'pong' || frame.type === 'ignore') {
      if (keys.length !== 1)
        throw new Error()
    }
    else if (frame.type === 'fatal') {
      if (keys.some(key => key !== 'type' && key !== 'code') || (frame.code !== undefined && typeof frame.code !== 'string'))
        throw new Error()
    }
    else {
      throw new Error()
    }
    return frame
  }
  catch {
    throw new SocketFuseError('PROTOCOL_ERROR')
  }
}
