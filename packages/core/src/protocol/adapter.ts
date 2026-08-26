/**
 * 定义 raw、声明式 JSON 与 custom Worker 协议适配器，并把原始 WebSocket payload
 * 分类为业务帧或控制帧。适配器只在拥有它的运行时执行，不能通过 MessagePort 传递函数。
 */
import type {
  AuthContext,
  ClassifyContext,
  DecodeContext,
  EncodeContext,
  HeartbeatContext,
  JsonMatcher,
  JsonProtocolOptions,
  JsonValue,
  MaybePromise,
  ProtocolAdapter,
  ProtocolCapabilities,
  ProtocolFrame,
  SocketData,
} from '../shared/types'
import { assertStructuredCloneable, isPlainRecord, stableSerialize } from '../shared/structured'
import { invalidOptions, SocketFuseError } from '../shared/errors'
import { isValidAdapterId } from '../config/normalize'

/** raw adapter 的能力快照；raw 不消费控制帧且不支持 SocketFuse heartbeat/auth。 */
const rawCapabilities: ProtocolCapabilities = Object.freeze({ auth: false, binary: true, heartbeat: false })

/** raw 协议：原样透传 WebSocket payload，并在 socket open 时 ready。 */
export const rawProtocol: ProtocolAdapter<SocketData, SocketData> = Object.freeze({
  capabilities: rawCapabilities,
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
  readyWhen: 'socket-open',
  version: 1,
})

/** 判断值是否为无循环的 JSON 结构。 */
function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
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
      return value.every(item => isJsonValue(item, seen))
    if (!isPlainRecord(value))
      return false
    return Object.values(value).every(item => isJsonValue(item, seen))
  }
  finally {
    seen.delete(value)
  }
}

/** 将 matcher 点号/下标路径解析为访问片段。 */
function pathSegments(path: string): (string | number)[] {
  if (path.length === 0)
    throw invalidOptions('JSON matcher paths must not be empty', 'protocol')
  const segments: (string | number)[] = []
  const pattern = /([A-Z_$][\w$-]*|\[(\d+)\])/gi
  let offset = 0
  for (const match of path.matchAll(pattern)) {
    if (match.index !== offset && !(offset === 0 && match.index === 0))
      throw invalidOptions(`Invalid JSON matcher path: ${path}`, 'protocol')
    const token = match[1]
    if (token === undefined)
      throw invalidOptions(`Invalid JSON matcher path: ${path}`, 'protocol')
    segments.push(match[2] === undefined ? token : Number(match[2]))
    offset = match.index + match[0].length
    if (path[offset] === '.')
      offset++
  }
  if (offset !== path.length || segments.length === 0)
    throw invalidOptions(`Invalid JSON matcher path: ${path}`, 'protocol')
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
function validateMatcher(matcher: unknown, field: string): asserts matcher is JsonMatcher {
  if (!isPlainRecord(matcher) || !Object.entries(matcher).every(([path, expected]) => {
    pathSegments(path)
    return isJsonValue(expected)
  })) {
    throw invalidOptions(`${field} must be a JSON matcher`, field)
  }
}

/** 将字符串、Blob 或二进制 payload 解码为有限 JSON 值。 */
function readJson(data: SocketData): MaybePromise<JsonValue> {
  if (typeof data === 'string') {
    try {
      const parsed: unknown = JSON.parse(data)
      if (!isJsonValue(parsed))
        throw new Error('not JSON value')
      return parsed
    }
    catch (cause) {
      throw new SocketFuseError('DECODE_FAILED', 'Unable to decode JSON message', { cause })
    }
  }
  if (data instanceof Blob)
    return data.text().then(text => readJson(text))
  try {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    return readJson(new TextDecoder().decode(bytes))
  }
  catch (cause) {
    throw new SocketFuseError('DECODE_FAILED', 'Unable to decode JSON message', { cause })
  }
}

/** 解析 `$auth` 占位符；未命中时保留原字符串。 */
function resolvePlaceholder(value: string, auth: unknown): unknown {
  if (value === '$auth')
    return auth
  if (!value.startsWith('$auth.'))
    return value
  return getPath(auth, value.slice('$auth.'.length))
}

/** 递归复制模板并替换认证占位符。 */
function applyTemplate(value: JsonValue, auth: unknown): JsonValue {
  if (typeof value === 'string')
    return resolvePlaceholder(value, auth) as JsonValue
  if (Array.isArray(value))
    return value.map(item => applyTemplate(item, auth))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyTemplate(item, auth)]))
  }
  return value
}

/** 在创建适配器前校验 JSON 协议的可克隆性和 matcher 约束。 */
function validateJsonOptions(options: JsonProtocolOptions): void {
  if (options.type !== 'json')
    throw invalidOptions('JSON protocol type must be json', 'protocol.type')
  const id = options.id ?? 'json'
  if (!isValidAdapterId(id))
    throw invalidOptions('protocol.id must be a stable lowercase adapter id', 'protocol.id')
  const version = options.version ?? 1
  if (!Number.isSafeInteger(version) || version <= 0)
    throw invalidOptions('protocol.version must be a positive safe integer', 'protocol.version')
  if (options.ready !== undefined)
    validateMatcher(options.ready, 'protocol.ready')
  if (options.ignore !== undefined) {
    if (!Array.isArray(options.ignore))
      throw invalidOptions('protocol.ignore must be an array', 'protocol.ignore')
    options.ignore.forEach((matcher, index) => validateMatcher(matcher, `protocol.ignore[${index}]`))
  }
  if (options.auth !== undefined) {
    if (!isPlainRecord(options.auth) || !('template' in options.auth) || !isJsonValue(options.auth.template))
      throw invalidOptions('protocol.auth must contain a JSON template', 'protocol.auth')
    assertStructuredCloneable(options.auth, 'protocol.auth')
  }
  if (options.heartbeat !== undefined) {
    if (!isPlainRecord(options.heartbeat) || !('ping' in options.heartbeat) || !('pong' in options.heartbeat))
      throw invalidOptions('protocol.heartbeat must contain ping and pong', 'protocol.heartbeat')
    if (!isJsonValue(options.heartbeat.ping) || !isJsonValue(options.heartbeat.serverPong ?? null))
      throw invalidOptions('protocol.heartbeat templates must be JSON values', 'protocol.heartbeat')
    validateMatcher(options.heartbeat.pong, 'protocol.heartbeat.pong')
    if (options.heartbeat.serverPing !== undefined)
      validateMatcher(options.heartbeat.serverPing, 'protocol.heartbeat.serverPing')
    assertStructuredCloneable(options.heartbeat, 'protocol.heartbeat')
  }
  assertStructuredCloneable(options, 'protocol')
}

/** 创建声明式 JSON 协议适配器。同步/异步 API 失败会转为稳定 SocketFuse 错误码。 */
export function createJsonProtocolAdapter(options: JsonProtocolOptions): ProtocolAdapter<JsonValue, JsonValue, unknown> {
  validateJsonOptions(options)
  const id = options.id ?? 'json'
  const version = options.version ?? 1
  const ready = options.ready
  const ignore = options.ignore ?? []
  const heartbeat = options.heartbeat
  const capabilities: ProtocolCapabilities = Object.freeze({
    auth: options.auth !== undefined,
    binary: false,
    heartbeat: heartbeat !== undefined,
  })
  const descriptorConfig = Object.freeze(JSON.parse(JSON.stringify(options)) as Record<string, unknown>)

  return Object.freeze({
    capabilities,
    /** 识别 ready、heartbeat、ignore 与业务帧。 */
    classify(data: JsonValue): ProtocolFrame<JsonValue> {
      if (ready !== undefined && matches(data, ready))
        return { type: 'ready' }
      if (heartbeat !== undefined && matches(data, heartbeat.pong))
        return { type: 'pong' }
      if (heartbeat?.serverPing !== undefined && matches(data, heartbeat.serverPing))
        return { data, type: 'ping' }
      if (ignore.some(matcher => matches(data, matcher)))
        return { type: 'ignore' }
      return { data, type: 'data' }
    },
    /** 按 auth 模板生成认证业务帧。 */
    createAuth(auth: unknown, context: AuthContext): JsonValue {
      void context
      if (options.auth === undefined)
        throw new SocketFuseError('CAPABILITY_UNSUPPORTED', 'JSON protocol does not declare an auth template')
      return applyTemplate(options.auth.template, auth)
    },
    /** 返回声明式 JSON ping 模板。 */
    createPing(context: HeartbeatContext): JsonValue {
      void context
      if (heartbeat === undefined)
        throw new SocketFuseError('CAPABILITY_UNSUPPORTED', 'JSON protocol does not declare a heartbeat template')
      return heartbeat.ping
    },
    /** 返回声明式 JSON server-pong 模板。 */
    createPong(ping: ProtocolFrame<JsonValue>, context: HeartbeatContext): JsonValue {
      void ping
      void context
      if (heartbeat?.serverPong === undefined)
        throw new SocketFuseError('CAPABILITY_UNSUPPORTED', 'JSON protocol does not declare a server pong template')
      return heartbeat.serverPong
    },
    /** 将原始 payload 解码为 JSON 值。 */
    decode(data: SocketData, context: DecodeContext): MaybePromise<JsonValue> {
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
      catch (cause) {
        throw new SocketFuseError('ENCODE_FAILED', 'Unable to encode JSON message', { cause })
      }
    },
    id,
    readyWhen: ready === undefined ? 'socket-open' : 'adapter-frame',
    sharedConfig: descriptorConfig,
    version,
  })
}

/** 将 raw/JSON 选择转换为参与共享冲突判断的协议描述。 */
export function getProtocolDescriptor(protocol: 'raw' | JsonProtocolOptions): {
  readonly kind: 'raw' | 'json'
  readonly id: string
  readonly version: number
  readonly capabilities: ProtocolCapabilities
  readonly readyWhen: 'socket-open' | 'adapter-frame'
  readonly sharedConfig: Readonly<Record<string, unknown>>
} {
  if (protocol === 'raw')
    return Object.freeze({ capabilities: rawCapabilities, id: 'raw', kind: 'raw', readyWhen: 'socket-open', sharedConfig: {}, version: 1 })
  const adapter = createJsonProtocolAdapter(protocol)
  return Object.freeze({ capabilities: adapter.capabilities, id: adapter.id, kind: 'json', readyWhen: adapter.readyWhen ?? 'socket-open', sharedConfig: adapter.sharedConfig ?? {}, version: adapter.version })
}

/** 校验 custom adapter 的跨 Worker 注册形状。 */
export function validateProtocolAdapter(value: unknown): asserts value is ProtocolAdapter<unknown, unknown, unknown> {
  if (!isPlainRecord(value)
    || typeof value.id !== 'string'
    || !isValidAdapterId(value.id)
    || typeof value.version !== 'number'
    || !Number.isSafeInteger(value.version)
    || value.version <= 0
    || !isPlainRecord(value.capabilities)
    || typeof value.capabilities.auth !== 'boolean'
    || typeof value.capabilities.binary !== 'boolean'
    || typeof value.capabilities.heartbeat !== 'boolean'
    || typeof value.encode !== 'function'
    || typeof value.decode !== 'function'
    || typeof value.classify !== 'function') {
    throw invalidOptions('protocol adapter has an invalid shape', 'protocol')
  }
}

/** 调用 adapter 编码业务值并校验返回的原生 WebSocket payload。 */
export async function encodeWithAdapter<Incoming, Outgoing, Auth>(
  adapter: ProtocolAdapter<Incoming, Outgoing, Auth>,
  data: Outgoing,
  context: EncodeContext,
): Promise<SocketData> {
  try {
    const encoded = await adapter.encode(data, context)
    if (typeof encoded !== 'string'
      && !(typeof Blob !== 'undefined' && encoded instanceof Blob)
      && !(encoded instanceof ArrayBuffer)
      && !ArrayBuffer.isView(encoded)) {
      throw new Error('Adapter returned unsupported WebSocket data')
    }
    return encoded
  }
  catch (cause) {
    if (cause instanceof SocketFuseError && cause.code === 'ENCODE_FAILED')
      throw cause
    throw new SocketFuseError('ENCODE_FAILED', 'Protocol adapter encode failed', { cause })
  }
}

/** 顺序解码并分类一条原始 socket payload，保护协议帧到达顺序。 */
export async function decodeAndClassify<Incoming, Outgoing, Auth>(
  adapter: ProtocolAdapter<Incoming, Outgoing, Auth>,
  data: SocketData,
  context: DecodeContext & ClassifyContext,
): Promise<ProtocolFrame<Incoming>> {
  let decoded: Incoming
  try {
    decoded = await adapter.decode(data, context)
  }
  catch (cause) {
    if (cause instanceof SocketFuseError && cause.code === 'DECODE_FAILED')
      throw cause
    throw new SocketFuseError('DECODE_FAILED', 'Protocol adapter decode failed', { cause })
  }
  try {
    const frame = await adapter.classify(decoded, context)
    if (frame === null || typeof frame !== 'object' || !['data', 'ready', 'ping', 'pong', 'ignore', 'fatal'].includes(frame.type))
      throw new Error('Adapter returned an invalid protocol frame')
    return frame
  }
  catch (cause) {
    if (cause instanceof SocketFuseError && cause.code === 'PROTOCOL_ERROR')
      throw cause
    throw new SocketFuseError('PROTOCOL_ERROR', 'Protocol adapter classify failed', { cause })
  }
}

export class OrderedProtocol<Incoming, Outgoing, Auth = unknown> {
  /** 上一条 decode/classify 完成 promise，确保异步 adapter 不乱序。 */
  private tail: Promise<void> = Promise.resolve()

  /** 创建绑定 adapter 的顺序处理器。 */
  constructor(readonly adapter: ProtocolAdapter<Incoming, Outgoing, Auth>) {}

  /** 排队处理一条 payload，并返回其协议帧。 */
  process(data: SocketData, context: DecodeContext & ClassifyContext): Promise<ProtocolFrame<Incoming>> {
    const result = this.tail.then(() => decodeAndClassify(this.adapter, data, context))
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
