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
  ProtocolAdapter,
  QueueOptions,
  ReconnectOptions,
  SocketData,
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
import { createJsonProtocolAdapter, getProtocolDescriptor, rawProtocol, validateProtocolAdapter } from '../protocol/adapter'
import { assertStructuredCloneable, stableHash, stableSerialize } from '../shared/structured'
import { normalizeEndpointUrl } from '../shared/endpoint'
import { invalidOptions } from '../shared/errors'

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

export interface SharedConnectionConfig {
  /** 原生 WebSocket subprotocol token 列表。 */
  readonly protocols: readonly string[]
  /** 规范化协议身份与共享静态配置。 */
  readonly protocol: NormalizedProtocolDescriptor
  /** Worker socket 的二进制接收表示。 */
  readonly binaryType: 'arraybuffer' | 'blob'
  /** 物理连接共用的重连策略。 */
  readonly reconnect: false | Readonly<ReconnectOptions>
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

export interface LocalClientConfig {
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

export interface NormalizedWebSocketConfig<Incoming, Outgoing> {
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
  /** 当前 realm 使用的协议适配器实现。 */
  readonly adapter: ProtocolAdapter<Incoming, Outgoing>
}

/** WebSocket subprotocol token 的语法约束。 */
const webSocketProtocolPattern = /^[!#$%&'*+\-.^`|~\w]+$/
/** custom adapter id 的稳定命名约束。 */
const adapterIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

/** 断言值为布尔选项并抛出字段化 INVALID_OPTIONS。 */
function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean')
    throw invalidOptions(`${field} must be a boolean`, field)
}

/** 校验有限数值，并按字段需要允许零。 */
function positiveNumber(value: unknown, field: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
    throw invalidOptions(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} finite number`, field)
  return value
}

/** 校验正安全整数配置。 */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw invalidOptions(`${field} must be a positive safe integer`, field)
  return value
}

/** 校验可同步参与共享 fingerprint 的 raw 心跳 payload。 */
function assertHeartbeatPayload(value: unknown, field: string): asserts value is HeartbeatPayload {
  if (typeof value !== 'string' && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value))
    throw invalidOptions(`${field} must be a string, ArrayBuffer, or ArrayBufferView`, field)
}

/** 规范化并去重 WebSocket subprotocol token。 */
function normalizeProtocols(protocols: string | readonly string[] | undefined): readonly string[] {
  const values = protocols === undefined ? [] : typeof protocols === 'string' ? [protocols] : [...protocols]
  const seen = new Set<string>()
  for (const protocol of values) {
    if (typeof protocol !== 'string' || protocol.length === 0 || !webSocketProtocolPattern.test(protocol))
      throw invalidOptions('protocols must contain valid WebSocket subprotocol tokens', 'protocols')
    if (seen.has(protocol))
      throw invalidOptions('protocols must not contain duplicate values', 'protocols')
    seen.add(protocol)
  }
  return Object.freeze(values)
}

/** 规范化共享重连策略及其边界。 */
function normalizeReconnect(value: boolean | Partial<ReconnectOptions> | undefined): false | Readonly<ReconnectOptions> {
  if (value === false)
    return false
  if (value !== undefined && value !== true && (value === null || typeof value !== 'object'))
    throw invalidOptions('autoReconnect must be a boolean or options object', 'autoReconnect')
  const input = value === undefined || value === true ? {} : value
  const retries = input.retries ?? DEFAULT_RECONNECT_OPTIONS.retries
  if (typeof retries !== 'number' || retries < 0 || (!Number.isSafeInteger(retries) && retries !== Number.POSITIVE_INFINITY))
    throw invalidOptions('autoReconnect.retries must be a non-negative safe integer or Infinity', 'autoReconnect.retries')
  const initialDelay = positiveNumber(input.initialDelay ?? DEFAULT_RECONNECT_OPTIONS.initialDelay, 'autoReconnect.initialDelay', true)
  const maxDelay = positiveNumber(input.maxDelay ?? DEFAULT_RECONNECT_OPTIONS.maxDelay, 'autoReconnect.maxDelay', true)
  const factor = positiveNumber(input.factor ?? DEFAULT_RECONNECT_OPTIONS.factor, 'autoReconnect.factor')
  const jitter = positiveNumber(input.jitter ?? DEFAULT_RECONNECT_OPTIONS.jitter, 'autoReconnect.jitter', true)
  if (jitter > 1)
    throw invalidOptions('autoReconnect.jitter must be between 0 and 1', 'autoReconnect.jitter')
  if (maxDelay < initialDelay)
    throw invalidOptions('autoReconnect.maxDelay must be at least initialDelay', 'autoReconnect.maxDelay')
  return Object.freeze({
    factor,
    initialDelay,
    jitter,
    maxDelay,
    retries,
    stableThreshold: positiveNumber(input.stableThreshold ?? DEFAULT_RECONNECT_OPTIONS.stableThreshold, 'autoReconnect.stableThreshold', true),
    hookTimeout: positiveNumber(input.hookTimeout ?? DEFAULT_RECONNECT_OPTIONS.hookTimeout, 'autoReconnect.hookTimeout'),
  })
}

/** 规范化共享心跳策略并验证其 payload 可跨 Worker。 */
function normalizeHeartbeat(value: boolean | Partial<HeartbeatOptions> | undefined, protocolKind: NormalizedProtocolDescriptor['kind']): false | Readonly<HeartbeatOptions> {
  if (value === false || value === undefined)
    return false
  if (value !== true && (value === null || typeof value !== 'object'))
    throw invalidOptions('heartbeat must be a boolean or options object', 'heartbeat')
  const input = value === true ? {} : value
  const mode = input.mode ?? DEFAULT_HEARTBEAT_OPTIONS.mode
  if (mode !== 'pong' && mode !== 'activity')
    throw invalidOptions('heartbeat.mode must be pong or activity', 'heartbeat.mode')
  const hasRawMessage = Object.prototype.hasOwnProperty.call(input, 'message')
  const hasRawResponse = Object.prototype.hasOwnProperty.call(input, 'responseMessage')
  if (protocolKind !== 'raw' && (hasRawMessage || hasRawResponse))
    throw invalidOptions('heartbeat.message and heartbeat.responseMessage are only available with the raw protocol', 'heartbeat')
  const pongTimeout = input.pongTimeout === undefined
    ? undefined
    : positiveNumber(input.pongTimeout, 'heartbeat.pongTimeout')
  const timing = {
    interval: positiveNumber(input.interval ?? DEFAULT_HEARTBEAT_OPTIONS.interval, 'heartbeat.interval'),
    mode,
    ...(pongTimeout === undefined ? {} : { pongTimeout }),
  }
  if (protocolKind !== 'raw')
    return Object.freeze(timing)
  const message = input.message ?? DEFAULT_HEARTBEAT_OPTIONS.message
  const responseMessage = input.responseMessage ?? DEFAULT_HEARTBEAT_OPTIONS.responseMessage
  assertHeartbeatPayload(message, 'heartbeat.message')
  assertHeartbeatPayload(responseMessage, 'heartbeat.responseMessage')
  assertStructuredCloneable(message, 'heartbeat.message')
  assertStructuredCloneable(responseMessage, 'heartbeat.responseMessage')
  return Object.freeze({ ...timing, message, responseMessage })
}

/** 规范化有界出站队列策略。 */
function normalizeQueue(value: boolean | Partial<QueueOptions> | undefined): Readonly<QueueOptions> {
  if (value !== undefined && typeof value !== 'boolean' && (value === null || typeof value !== 'object'))
    throw invalidOptions('queue must be a boolean or options object', 'queue')
  const enabled = value === true
  const input = value === undefined || typeof value === 'boolean' ? {} : value
  const whenDisconnected = input.whenDisconnected ?? enabled
  const whenBackpressured = input.whenBackpressured ?? enabled
  assertBoolean(whenDisconnected, 'queue.whenDisconnected')
  assertBoolean(whenBackpressured, 'queue.whenBackpressured')
  return Object.freeze({
    maxBytes: positiveInteger(input.maxBytes ?? DEFAULT_QUEUE_OPTIONS.maxBytes, 'queue.maxBytes'),
    maxMessages: positiveInteger(input.maxMessages ?? DEFAULT_QUEUE_OPTIONS.maxMessages, 'queue.maxMessages'),
    whenBackpressured,
    whenDisconnected,
  })
}

/** 规范化原生 bufferedAmount 高低水位。 */
function normalizeBackpressure(value: Partial<BackpressureOptions> | undefined): Readonly<BackpressureOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('backpressure must be an options object', 'backpressure')
  const highWaterMarkBytes = positiveInteger(value?.highWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.highWaterMarkBytes, 'backpressure.highWaterMarkBytes')
  const lowWaterMarkBytes = positiveNumber(value?.lowWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.lowWaterMarkBytes, 'backpressure.lowWaterMarkBytes', true)
  if (lowWaterMarkBytes >= highWaterMarkBytes)
    throw invalidOptions('backpressure.lowWaterMarkBytes must be lower than highWaterMarkBytes', 'backpressure.lowWaterMarkBytes')
  return Object.freeze({ highWaterMarkBytes, lowWaterMarkBytes })
}

/** 规范化页面活性租约并确保 timeout 大于 interval。 */
function normalizeLease(value: Partial<LeaseOptions> | undefined): Readonly<LeaseOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('lease must be an options object', 'lease')
  const interval = positiveNumber(value?.interval ?? DEFAULT_LEASE_OPTIONS.interval, 'lease.interval')
  const timeout = positiveNumber(value?.timeout ?? DEFAULT_LEASE_OPTIONS.timeout, 'lease.timeout')
  if (timeout <= interval)
    throw invalidOptions('lease.timeout must be greater than lease.interval', 'lease.timeout')
  return Object.freeze({ interval, timeout })
}

/** 规范化单条物理连接的资源上限。 */
function normalizeLimits(value: Partial<ConnectionLimits> | undefined): Readonly<ConnectionLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('limits must be an options object', 'limits')
  return Object.freeze({
    maxClientsPerConnection: positiveInteger(value?.maxClientsPerConnection ?? DEFAULT_CONNECTION_LIMITS.maxClientsPerConnection, 'limits.maxClientsPerConnection'),
    maxEncodedMessageBytes: positiveInteger(value?.maxEncodedMessageBytes ?? DEFAULT_CONNECTION_LIMITS.maxEncodedMessageBytes, 'limits.maxEncodedMessageBytes'),
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
    throw invalidOptions('lifecycle.restore must be a boolean or options object', 'lifecycle.restore')
  const replay = restore.replay ?? false
  assertBoolean(replay, 'lifecycle.restore.replay')
  return Object.freeze({
    enabled: true,
    maxBytes: positiveInteger(restore.maxBytes ?? DEFAULT_REPLAY_MAX_BYTES, 'lifecycle.restore.maxBytes'),
    maxMessages: positiveInteger(restore.maxMessages ?? DEFAULT_REPLAY_MAX_MESSAGES, 'lifecycle.restore.maxMessages'),
    replay,
  })
}

/** 解析 raw、JSON 或 custom adapter，并生成共享协议描述。 */
function normalizeProtocol<Incoming, Outgoing>(
  protocol: CreateWebSocketOptions<Incoming, Outgoing>['protocol'],
): { descriptor: NormalizedProtocolDescriptor, adapter: ProtocolAdapter<Incoming, Outgoing> | null } {
  if (protocol === undefined || protocol === 'raw')
    return { adapter: null, descriptor: getProtocolDescriptor('raw') }

  if (typeof protocol !== 'object' || protocol === null)
    throw invalidOptions('protocol must be raw, JSON options, or a protocol adapter', 'protocol')

  if ('type' in protocol && protocol.type === 'json') {
    const adapter = createJsonProtocolAdapter(protocol as JsonProtocolOptions) as unknown as ProtocolAdapter<Incoming, Outgoing>
    return { adapter, descriptor: getProtocolDescriptor(protocol as JsonProtocolOptions) }
  }

  validateProtocolAdapter(protocol)
  const adapter = protocol as ProtocolAdapter<Incoming, Outgoing>
  const sharedConfig = adapter.sharedConfig ?? {}
  assertStructuredCloneable(sharedConfig, 'protocol.sharedConfig')
  return {
    adapter,
    descriptor: Object.freeze({
      id: adapter.id,
      kind: 'custom',
      sharedConfig,
      version: adapter.version,
    }),
  }
}

/** 将创建选项拆分为共享配置与页面本地配置。 */
export function normalizeWebSocketOptions<Incoming = SocketData, Outgoing = SocketData>(
  url: string,
  options: CreateWebSocketOptions<Incoming, Outgoing>,
): NormalizedWebSocketConfig<Incoming, Outgoing> {
  if (options === null || typeof options !== 'object')
    throw invalidOptions('options must be an object', 'options')
  if (typeof options.id !== 'string' || options.id.trim().length === 0)
    throw invalidOptions('id must be a non-empty string', 'id')
  if (options.id.length > 1_024)
    throw invalidOptions('id must be at most 1024 characters', 'id')
  if (options.fallback !== undefined && options.fallback !== 'direct' && options.fallback !== 'error')
    throw invalidOptions('fallback must be direct or error', 'fallback')
  if (options.binaryType !== undefined && options.binaryType !== 'arraybuffer' && options.binaryType !== 'blob')
    throw invalidOptions('binaryType must be arraybuffer or blob', 'binaryType')
  if (options.worker !== undefined && typeof options.worker !== 'function')
    throw invalidOptions('worker must be a SharedWorker factory', 'worker')

  const { adapter, descriptor } = normalizeProtocol(options.protocol)
  if (descriptor.kind === 'custom' && options.worker === undefined)
    throw invalidOptions('A custom protocol adapter requires a custom worker factory', 'protocol')

  const shared: SharedConnectionConfig = Object.freeze({
    backpressure: normalizeBackpressure(options.backpressure),
    binaryType: options.binaryType ?? 'arraybuffer',
    connectionTimeout: positiveNumber(options.connectionTimeout ?? DEFAULT_CONNECTION_TIMEOUT, 'connectionTimeout'),
    heartbeat: normalizeHeartbeat(options.heartbeat, descriptor.kind),
    idleGraceMs: positiveNumber(options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS, 'idleGraceMs', true),
    lease: normalizeLease(options.lease),
    limits: normalizeLimits(options.limits),
    protocol: descriptor,
    protocols: normalizeProtocols(options.protocols),
    queue: normalizeQueue(options.queue),
    reconnect: normalizeReconnect(options.autoReconnect),
  })
  if (shared.heartbeat !== false && descriptor.kind !== 'raw' && adapter?.createPing === undefined)
    throw invalidOptions('heartbeat requires the protocol adapter to implement createPing', 'heartbeat')

  const configCanonical = stableSerialize(shared)
  return Object.freeze({
    adapter: adapter ?? rawProtocol as unknown as ProtocolAdapter<Incoming, Outgoing>,
    configCanonical,
    configFingerprint: stableHash(shared),
    id: options.id,
    local: Object.freeze({
      autoClose: options.autoClose ?? true,
      fallback: options.fallback ?? 'direct',
      immediate: options.immediate ?? true,
      lifecycle: normalizeRestoreOptions(options.lifecycle),
      logger: options.logger,
      workerMode: options.worker === undefined ? 'inline' : 'custom',
    }),
    shared,
    url: normalizeEndpointUrl(url, 'url', 'url'),
  })
}

/** 比较两个规范化共享字段是否冲突；endpoint 不属于共享身份。 */
export function hasConfigConflict(
  current: Pick<NormalizedWebSocketConfig<unknown, unknown>, 'configCanonical'>,
  incoming: Pick<NormalizedWebSocketConfig<unknown, unknown>, 'configCanonical'>,
): boolean {
  return current.configCanonical !== incoming.configCanonical
}

/** 判断 custom adapter id 是否符合稳定命名约束。 */
export function isValidAdapterId(value: string): boolean {
  return adapterIdPattern.test(value)
}
