/**
 * 将页面创建选项规范化为共享物理配置与页面本地配置。
 *
 * 共享字段会参与 canonical/fingerprint；本地 handler、Worker 工厂和 lifecycle 设置
 * 不参与冲突判断，从而允许每个标签页独立控制自身生命周期。
 */
import type {
  BackpressureOptions,
  ConnectionLimits,
  CreateWebSocketOptions,
  HeartbeatOptions,
  HeartbeatPayload,
  JsonProtocolOptions,
  LeaseOptions,
  NormalizedRestoreOptions,
  QueueOptions,
  ReconnectOptions,
  SocketFuseLogger,
} from '../shared/types'
import {
  DEFAULT_BACKPRESSURE_OPTIONS,
  DEFAULT_CONNECTION_LIMITS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_HEARTBEAT_OPTIONS,
  DEFAULT_IDLE_GRACE_MS,
  DEFAULT_LEASE_OPTIONS,
  DEFAULT_QUEUE_OPTIONS,
  DEFAULT_RECONNECT_OPTIONS,
  DEFAULT_REPLAY_MAX_BYTES,
  DEFAULT_REPLAY_MAX_MESSAGES,
} from '../shared/constants'
import { assertStructuredCloneable, isPlainRecord, stableHash, stableSerialize } from '../shared/structured'
import { getProtocolDescriptor, isValidAdapterId } from '../protocol/adapter'
import { normalizeEndpointUrl } from '../shared/endpoint'
import { invalidOptions } from '../shared/errors'

/** 参与共享冲突判断的完整静态协议身份。 */
export interface NormalizedProtocolDescriptor {
  /** 适配器种类，参与共享配置身份。 */
  readonly kind: 'raw' | 'json' | 'custom'
  /** Worker 端查找适配器的稳定 id。 */
  readonly id: string
  /** 适配器主版本，变更必须触发配置冲突。 */
  readonly version: number
  /** 可跨 Worker 的共享协议配置，不得包含页面秘密。 */
  readonly sharedConfig: Readonly<Record<string, unknown>>
}

/** 单一物理连接的所有参与者必须一致的策略。 */
export interface SharedConnectionConfig {
  /** 原生 WebSocket subprotocol token 列表。 */
  readonly protocols: readonly string[]
  /** 规范化协议身份与共享静态配置。 */
  readonly protocol: NormalizedProtocolDescriptor
  /** 物理连接共用的重连策略。 */
  readonly reconnect: Readonly<ReconnectOptions>
  /** 原生 WebSocket 建连超时，单位为毫秒。 */
  readonly connectionTimeout: number
  /** 物理连接共用的心跳策略。 */
  readonly heartbeat: false | Readonly<HeartbeatOptions>
  /** 有界出站队列策略。 */
  readonly queue: Readonly<QueueOptions>
  /** 原生 bufferedAmount 高低水位。 */
  readonly backpressure: Readonly<BackpressureOptions>
  /** 页面活性租约策略。 */
  readonly lease: Readonly<LeaseOptions>
  /** 物理连接的 client 数量和 payload 大小上限。 */
  readonly limits: Readonly<ConnectionLimits>
  /** 无 client 时关闭物理 socket 前的宽限期，单位为毫秒。 */
  readonly idleGraceMs: number
}

/** 只影响当前页面的显示、部署和参与行为。 */
export interface LocalClientConfig {
  /** raw 入站在当前页面的表示，不改变共享 wire 或 canonical。 */
  readonly binaryType: 'arraybuffer' | 'blob'
  /** Worker 初始化失败时的页面本地处理。 */
  readonly fallback: 'direct' | 'error'
  /** 创建后是否立即异步调用 open。 */
  readonly immediate: boolean
  /** 页面卸载时是否自动 detach。 */
  readonly autoClose: boolean
  /** 页面 freeze/restore 与回放策略。 */
  readonly lifecycle: Readonly<NormalizedRestoreOptions>
  /** Worker 来源模式。 */
  readonly workerMode: 'inline' | 'custom'
  /** 只在当前页面调用的脱敏日志函数。 */
  readonly logger: SocketFuseLogger | undefined
}

/** 校验完成的初始 endpoint、共享策略和页面策略。 */
export interface NormalizedWebSocketConfig {
  /** 共享连接的业务 identity。 */
  readonly id: string
  /** 当前 endpoint 的绝对 ws/wss URL。 */
  readonly url: string
  /** 参与 Worker 冲突判断的物理配置。 */
  readonly shared: SharedConnectionConfig
  /** 不参与冲突判断的页面本地配置。 */
  readonly local: LocalClientConfig
  /** 共享配置的键顺序稳定表示。 */
  readonly configCanonical: string
  /** 共享配置的稳定 hash。 */
  readonly configFingerprint: string
}

/** WebSocket subprotocol token 的语法约束。 */
const webSocketProtocolPattern = /^[!#$%&'*+\-.^`|~\w]+$/

/** 断言值为布尔选项并抛出字段化 INVALID_OPTIONS。 */
function assertBoolean(value: unknown): asserts value is boolean {
  if (typeof value !== 'boolean')
    throw invalidOptions()
}

/** 校验有限数值，并按字段需要允许零。 */
function positiveNumber(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
    throw invalidOptions()
  return value
}

/** 校验正安全整数配置。 */
function positiveInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw invalidOptions()
  return value
}

/** 校验可同步参与共享 fingerprint 的 raw 心跳 payload。 */
function assertHeartbeatPayload(value: unknown): asserts value is HeartbeatPayload {
  if (typeof value !== 'string' && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value))
    throw invalidOptions()
}

/** 规范化并去重 WebSocket subprotocol token。 */
function normalizeProtocols(protocols: string | readonly string[] | undefined): readonly string[] {
  const values = protocols === undefined ? [] : typeof protocols === 'string' ? [protocols] : [...protocols]
  const seen = new Set<string>()
  for (const protocol of values) {
    if (typeof protocol !== 'string' || protocol.length === 0 || !webSocketProtocolPattern.test(protocol))
      throw invalidOptions()
    if (seen.has(protocol))
      throw invalidOptions()
    seen.add(protocol)
  }
  return Object.freeze(values)
}

/** 校验平台能够精确表达的整数毫秒。 */
function milliseconds(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value > 2_147_483_647 || (allowZero ? value < 0 : value <= 0))
    throw invalidOptions()
  return value
}

/** 拒绝未知对象字段，避免旧配置在破坏性升级后被静默忽略。 */
function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return isPlainRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}

/** 规范化自动开关、共享预算及指数退避；显式请求不会改变这些配置。 */
function normalizeReconnect(value: Partial<ReconnectOptions> | undefined): Readonly<ReconnectOptions> {
  if (value === null)
    throw invalidOptions()
  const input = value ?? {}
  if (!exactKeys(input, [], ['automatic', 'maxRetries', 'initialDelay', 'maxDelay', 'factor', 'jitter', 'stableThreshold', 'hookTimeout']))
    throw invalidOptions()
  const automatic = input.automatic ?? DEFAULT_RECONNECT_OPTIONS.automatic
  assertBoolean(automatic)
  const maxRetries = input.maxRetries ?? DEFAULT_RECONNECT_OPTIONS.maxRetries
  if (typeof maxRetries !== 'number' || maxRetries < 0 || (!Number.isSafeInteger(maxRetries) && maxRetries !== Number.POSITIVE_INFINITY))
    throw invalidOptions()
  const initialDelay = milliseconds(input.initialDelay ?? DEFAULT_RECONNECT_OPTIONS.initialDelay, true)
  const maxDelay = milliseconds(input.maxDelay ?? DEFAULT_RECONNECT_OPTIONS.maxDelay, true)
  const factor = positiveNumber(input.factor ?? DEFAULT_RECONNECT_OPTIONS.factor)
  const jitter = positiveNumber(input.jitter ?? DEFAULT_RECONNECT_OPTIONS.jitter, true)
  if (jitter > 1 || maxDelay < initialDelay)
    throw invalidOptions()
  const stableThreshold = input.stableThreshold ?? DEFAULT_RECONNECT_OPTIONS.stableThreshold
  return Object.freeze({ automatic, factor, initialDelay, jitter, maxDelay, maxRetries,
    stableThreshold: stableThreshold === false ? false : milliseconds(stableThreshold),
    hookTimeout: milliseconds(input.hookTimeout ?? DEFAULT_RECONNECT_OPTIONS.hookTimeout),
  })
}

/** 规范化共享心跳策略并验证其 payload 可跨 Worker。 */
function normalizeHeartbeat(value: boolean | Partial<HeartbeatOptions> | undefined, protocolKind: NormalizedProtocolDescriptor['kind']): false | Readonly<HeartbeatOptions> {
  if (value === false || value === undefined)
    return false
  if (value !== true && (value === null || typeof value !== 'object'))
    throw invalidOptions()
  const input = value === true ? {} : value
  const mode = input.mode ?? DEFAULT_HEARTBEAT_OPTIONS.mode
  if (mode !== 'pong' && mode !== 'activity')
    throw invalidOptions()
  const hasRawMessage = Object.prototype.hasOwnProperty.call(input, 'message')
  const hasRawResponse = Object.prototype.hasOwnProperty.call(input, 'responseMessage')
  if (protocolKind !== 'raw' && (hasRawMessage || hasRawResponse))
    throw invalidOptions()
  const pongTimeout = input.pongTimeout === undefined
    ? undefined
    : milliseconds(input.pongTimeout)
  const timing = {
    interval: milliseconds(input.interval ?? DEFAULT_HEARTBEAT_OPTIONS.interval),
    mode,
    ...(pongTimeout === undefined ? {} : { pongTimeout }),
  }
  if (protocolKind !== 'raw')
    return Object.freeze(timing)
  const message = input.message ?? DEFAULT_HEARTBEAT_OPTIONS.message
  const responseMessage = input.responseMessage ?? DEFAULT_HEARTBEAT_OPTIONS.responseMessage
  assertHeartbeatPayload(message)
  assertHeartbeatPayload(responseMessage)
  assertStructuredCloneable(message)
  assertStructuredCloneable(responseMessage)
  return Object.freeze({ ...timing, message: structuredClone(message), responseMessage: structuredClone(responseMessage) })
}

/** 规范化有界出站队列策略。 */
function normalizeQueue(value: boolean | Partial<QueueOptions> | undefined): Readonly<QueueOptions> {
  if (value !== undefined && typeof value !== 'boolean' && (value === null || typeof value !== 'object'))
    throw invalidOptions()
  const enabled = value === true
  const input = value === undefined || typeof value === 'boolean' ? {} : value
  const whenDisconnected = input.whenDisconnected ?? enabled
  const whenBackpressured = input.whenBackpressured ?? enabled
  assertBoolean(whenDisconnected)
  assertBoolean(whenBackpressured)
  return Object.freeze({
    maxBytes: positiveInteger(input.maxBytes ?? DEFAULT_QUEUE_OPTIONS.maxBytes),
    maxMessages: positiveInteger(input.maxMessages ?? DEFAULT_QUEUE_OPTIONS.maxMessages),
    whenBackpressured,
    whenDisconnected,
  })
}

/** 规范化原生 bufferedAmount 高低水位。 */
function normalizeBackpressure(value: Partial<BackpressureOptions> | undefined): Readonly<BackpressureOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions()
  const highWaterMarkBytes = positiveInteger(value?.highWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.highWaterMarkBytes)
  const lowWaterMarkBytes = positiveNumber(value?.lowWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.lowWaterMarkBytes, true)
  if (lowWaterMarkBytes >= highWaterMarkBytes)
    throw invalidOptions()
  return Object.freeze({ highWaterMarkBytes, lowWaterMarkBytes })
}

/** 规范化页面活性租约并确保 timeout 大于 interval。 */
function normalizeLease(value: Partial<LeaseOptions> | undefined): Readonly<LeaseOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions()
  const interval = milliseconds(value?.interval ?? DEFAULT_LEASE_OPTIONS.interval)
  const timeout = milliseconds(value?.timeout ?? DEFAULT_LEASE_OPTIONS.timeout)
  if (timeout <= interval)
    throw invalidOptions()
  return Object.freeze({ interval, timeout })
}

/** 规范化单条物理连接的资源上限。 */
function normalizeLimits(value: Partial<ConnectionLimits> | undefined): Readonly<ConnectionLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions()
  return Object.freeze({
    maxClientsPerConnection: positiveInteger(value?.maxClientsPerConnection ?? DEFAULT_CONNECTION_LIMITS.maxClientsPerConnection),
    maxEncodedMessageBytes: positiveInteger(value?.maxEncodedMessageBytes ?? DEFAULT_CONNECTION_LIMITS.maxEncodedMessageBytes),
  })
}

/** 将页面 lifecycle 选项转换为 Worker 可复用的有限回放配置。 */
export function normalizeRestoreOptions(value: CreateWebSocketOptions['lifecycle']): Readonly<NormalizedRestoreOptions> {
  const restore = value?.restore
  if (restore === undefined || restore === false)
    return Object.freeze({ enabled: false, maxBytes: DEFAULT_REPLAY_MAX_BYTES, maxMessages: DEFAULT_REPLAY_MAX_MESSAGES, replay: false })
  if (restore === true)
    return Object.freeze({ enabled: true, maxBytes: DEFAULT_REPLAY_MAX_BYTES, maxMessages: DEFAULT_REPLAY_MAX_MESSAGES, replay: false })
  if (restore === null || typeof restore !== 'object')
    throw invalidOptions()
  const replay = restore.replay ?? false
  assertBoolean(replay)
  return Object.freeze({
    enabled: true,
    maxBytes: positiveInteger(restore.maxBytes ?? DEFAULT_REPLAY_MAX_BYTES),
    maxMessages: positiveInteger(restore.maxMessages ?? DEFAULT_REPLAY_MAX_MESSAGES),
    replay,
  })
}

/** 规范化页面协议描述；自定义实现仅在 Worker 静态注册。 */
function normalizeProtocol(protocol: CreateWebSocketOptions['protocol']): NormalizedProtocolDescriptor {
  if (protocol === undefined || protocol === 'raw')
    return getProtocolDescriptor('raw')
  if (!isPlainRecord(protocol))
    throw invalidOptions()
  if (protocol.type === 'json')
    return getProtocolDescriptor(protocol as unknown as JsonProtocolOptions)
  if (!exactKeys(protocol, ['type', 'id', 'version'], ['sharedConfig']) || protocol.type !== 'custom'
    || typeof protocol.id !== 'string' || !isValidAdapterId(protocol.id)
    || typeof protocol.version !== 'number' || !Number.isSafeInteger(protocol.version) || protocol.version <= 0)
    throw invalidOptions()
  const sharedConfig = protocol.sharedConfig ?? {}
  if (!isPlainRecord(sharedConfig))
    throw invalidOptions()
  assertStructuredCloneable(sharedConfig)
  return Object.freeze({ id: protocol.id, kind: 'custom', version: protocol.version, sharedConfig: structuredClone(sharedConfig) })
}

/**
 * 校验控制边界中的完整共享配置，与页面规范化共用各字段的语义约束。
 * @param value 已通过 envelope 大小检查的未知配置。
 * @returns 完整且 canonical 与规范化结果相同才返回 true；不为 Worker 输入补默认。
 */
export function isSharedConnectionConfig(value: unknown): value is SharedConnectionConfig {
  try {
    if (!exactKeys(value, ['protocols', 'protocol', 'reconnect', 'connectionTimeout', 'heartbeat', 'queue', 'backpressure', 'lease', 'limits', 'idleGraceMs'])
      || !exactKeys(value.reconnect, ['automatic', 'maxRetries', 'initialDelay', 'maxDelay', 'factor', 'jitter', 'stableThreshold', 'hookTimeout'])
      || !exactKeys(value.queue, ['whenDisconnected', 'whenBackpressured', 'maxMessages', 'maxBytes'])
      || !exactKeys(value.backpressure, ['highWaterMarkBytes', 'lowWaterMarkBytes'])
      || !exactKeys(value.lease, ['interval', 'timeout'])
      || !exactKeys(value.limits, ['maxClientsPerConnection', 'maxEncodedMessageBytes'])
      || !exactKeys(value.protocol, ['kind', 'id', 'version', 'sharedConfig'])
      || !Array.isArray(value.protocols))
      return false
    const protocol = value.protocol
    if (protocol.kind !== 'raw' && protocol.kind !== 'json' && protocol.kind !== 'custom')
      return false
    if (value.heartbeat !== false && !exactKeys(value.heartbeat, ['mode', 'interval'], ['pongTimeout', 'message', 'responseMessage']))
      return false
    const normalizedProtocol = protocol.kind === 'raw'
      ? getProtocolDescriptor('raw')
      : protocol.kind === 'json'
        ? getProtocolDescriptor(protocol.sharedConfig as JsonProtocolOptions)
        : normalizeProtocol({ type: 'custom', id: protocol.id, version: protocol.version, sharedConfig: protocol.sharedConfig } as CreateWebSocketOptions['protocol'])
    const normalized: SharedConnectionConfig = {
      protocols: normalizeProtocols(value.protocols as string[]),
      protocol: normalizedProtocol,
      reconnect: normalizeReconnect(value.reconnect as unknown as ReconnectOptions),
      connectionTimeout: milliseconds(value.connectionTimeout),
      heartbeat: normalizeHeartbeat(value.heartbeat as HeartbeatOptions | false, normalizedProtocol.kind),
      queue: normalizeQueue(value.queue as unknown as QueueOptions),
      backpressure: normalizeBackpressure(value.backpressure as unknown as BackpressureOptions),
      lease: normalizeLease(value.lease as unknown as LeaseOptions),
      limits: normalizeLimits(value.limits as unknown as ConnectionLimits),
      idleGraceMs: milliseconds(value.idleGraceMs, true),
    }
    // 精确比较同时拒绝 null、缺字段、错误原型与非规范 descriptor。
    return stableSerialize(normalized) === stableSerialize(value)
  }
  catch {
    return false
  }
}

/** 将创建选项拆分为共享配置与页面本地配置。 */
export function normalizeWebSocketOptions<Incoming, Outgoing>(
  url: string,
  options: CreateWebSocketOptions<Incoming, Outgoing>,
): NormalizedWebSocketConfig {
  if (options === null || typeof options !== 'object')
    throw invalidOptions()
  if (typeof options.id !== 'string' || options.id.trim().length === 0)
    throw invalidOptions()
  if (options.id.length > 1_024)
    throw invalidOptions()
  if (options.fallback !== undefined && options.fallback !== 'direct' && options.fallback !== 'error')
    throw invalidOptions()
  if (options.binaryType !== undefined && options.binaryType !== 'arraybuffer' && options.binaryType !== 'blob')
    throw invalidOptions()
  if (options.worker !== undefined && typeof options.worker !== 'function')
    throw invalidOptions()

  if ('autoReconnect' in options || (options.worker !== undefined && options.fallback === 'direct'))
    throw invalidOptions()
  const descriptor = normalizeProtocol(options.protocol)
  if (options.binaryType !== undefined && descriptor.kind !== 'raw')
    throw invalidOptions()
  for (const value of [options.immediate, options.autoClose]) {
    if (value !== undefined)
      assertBoolean(value)
  }
  if (descriptor.kind === 'custom' && options.worker === undefined)
    throw invalidOptions()

  const shared: SharedConnectionConfig = Object.freeze({
    backpressure: normalizeBackpressure(options.backpressure),
    connectionTimeout: milliseconds(options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT),
    heartbeat: normalizeHeartbeat(options.heartbeat, descriptor.kind),
    idleGraceMs: milliseconds(options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS, true),
    lease: normalizeLease(options.lease),
    limits: normalizeLimits(options.limits),
    protocol: descriptor,
    protocols: normalizeProtocols(options.protocols),
    queue: normalizeQueue(options.queue),
    reconnect: normalizeReconnect(options.reconnect),
  })

  const configCanonical = stableSerialize(shared)
  return Object.freeze({
    configCanonical,
    configFingerprint: stableHash(shared),
    id: options.id,
    local: Object.freeze({
      autoClose: options.autoClose ?? true,
      binaryType: options.binaryType ?? 'arraybuffer',
      fallback: options.fallback ?? (options.worker === undefined ? 'direct' : 'error'),
      immediate: options.immediate ?? true,
      lifecycle: normalizeRestoreOptions(options.lifecycle),
      logger: options.logger,
      workerMode: options.worker === undefined ? 'inline' : 'custom',
    }),
    shared,
    url: normalizeEndpointUrl(url),
  })
}

/** 比较两个规范化共享字段是否冲突；endpoint 不属于共享身份。 */
export function hasConfigConflict(
  current: Pick<NormalizedWebSocketConfig, 'configCanonical'>,
  incoming: Pick<NormalizedWebSocketConfig, 'configCanonical'>,
): boolean {
  return current.configCanonical !== incoming.configCanonical
}
