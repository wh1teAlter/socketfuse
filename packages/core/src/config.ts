import type {
  BackpressureOptions,
  CreateWebSocketOptions,
  HeartbeatOptions,
  JsonProtocolOptions,
  LeaseOptions,
  NormalizedRestoreOptions,
  ProtocolAdapter,
  ProtocolCapabilities,
  QueueOptions,
  ReconnectOptions,
  ResourceLimits,
  SocketData,
  WwsLogger,
} from './types'
import {
  DEFAULT_BACKPRESSURE_OPTIONS,
  DEFAULT_CONNECTION_TIMEOUT,
  DEFAULT_HEARTBEAT_OPTIONS,
  DEFAULT_IDLE_GRACE_MS,
  DEFAULT_LEASE_OPTIONS,
  DEFAULT_QUEUE_OPTIONS,
  DEFAULT_RECONNECT_OPTIONS,
  DEFAULT_REPLAY_MAX_BYTES,
  DEFAULT_REPLAY_MAX_MESSAGES,
  DEFAULT_RESOURCE_LIMITS,
} from './constants'
import { invalidOptions } from './errors'
import { createJsonProtocolAdapter, getProtocolDescriptor, rawProtocol, validateProtocolAdapter } from './protocol'
import { assertStructuredCloneable, stableHash, stableSerialize } from './structured'

export interface NormalizedProtocolDescriptor {
  readonly kind: 'raw' | 'json' | 'custom'
  readonly id: string
  readonly version: number
  readonly capabilities: ProtocolCapabilities
  readonly readyWhen: 'socket-open' | 'adapter-frame'
  readonly sharedConfig: Readonly<Record<string, unknown>>
}

export interface SharedConnectionConfig {
  readonly protocols: readonly string[]
  readonly protocol: NormalizedProtocolDescriptor
  readonly binaryType: 'arraybuffer' | 'blob'
  readonly reconnect: false | Readonly<ReconnectOptions>
  readonly connectionTimeout: number
  readonly heartbeat: false | Readonly<HeartbeatOptions>
  readonly queue: Readonly<QueueOptions>
  readonly backpressure: Readonly<BackpressureOptions>
  readonly lease: Readonly<LeaseOptions>
  readonly limits: Readonly<ResourceLimits>
  readonly idleGraceMs: number
}

export interface LocalClientConfig {
  readonly fallback: 'direct' | 'error'
  readonly immediate: boolean
  readonly autoClose: boolean
  readonly lifecycle: Readonly<NormalizedRestoreOptions>
  readonly workerMode: 'inline' | 'custom'
  readonly logger: WwsLogger | undefined
}

export interface NormalizedWebSocketConfig<Incoming, Outgoing, Auth> {
  readonly id: string
  readonly url: string
  readonly shared: SharedConnectionConfig
  readonly local: LocalClientConfig
  readonly configCanonical: string
  readonly configFingerprint: string
  readonly adapter: ProtocolAdapter<Incoming, Outgoing, Auth>
}

const webSocketProtocolPattern = /^[!#$%&'*+\-.^`|~\w]+$/
const adapterIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/

function assertBoolean(value: unknown, field: string): asserts value is boolean {
  if (typeof value !== 'boolean')
    throw invalidOptions(`${field} must be a boolean`, field)
}

function positiveNumber(value: unknown, field: string, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (allowZero ? value < 0 : value <= 0))
    throw invalidOptions(`${field} must be a ${allowZero ? 'non-negative' : 'positive'} finite number`, field)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw invalidOptions(`${field} must be a positive safe integer`, field)
  return value
}

function normalizeUrl(url: string | URL): string {
  let parsed: URL
  try {
    parsed = url instanceof URL ? new URL(url.href) : new URL(url)
  }
  catch {
    throw invalidOptions('url must be an absolute ws: or wss: URL', 'url')
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
    throw invalidOptions('url must use the ws: or wss: protocol', 'url')
  return parsed.href
}

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
  })
}

function normalizeHeartbeat(value: boolean | Partial<HeartbeatOptions> | undefined): false | Readonly<HeartbeatOptions> {
  if (value === false || value === undefined)
    return false
  if (value !== true && (value === null || typeof value !== 'object'))
    throw invalidOptions('heartbeat must be a boolean or options object', 'heartbeat')
  const input = value === true ? {} : value
  const mode = input.mode ?? DEFAULT_HEARTBEAT_OPTIONS.mode
  if (mode !== 'pong' && mode !== 'activity')
    throw invalidOptions('heartbeat.mode must be pong or activity', 'heartbeat.mode')
  const message = input.message ?? DEFAULT_HEARTBEAT_OPTIONS.message
  const responseMessage = input.responseMessage ?? DEFAULT_HEARTBEAT_OPTIONS.responseMessage
  assertStructuredCloneable(message, 'heartbeat.message')
  assertStructuredCloneable(responseMessage, 'heartbeat.responseMessage')
  return Object.freeze({
    interval: positiveNumber(input.interval ?? DEFAULT_HEARTBEAT_OPTIONS.interval, 'heartbeat.interval'),
    message,
    mode,
    pongTimeout: positiveNumber(input.pongTimeout ?? DEFAULT_HEARTBEAT_OPTIONS.pongTimeout, 'heartbeat.pongTimeout'),
    responseMessage,
  })
}

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

function normalizeBackpressure(value: Partial<BackpressureOptions> | undefined): Readonly<BackpressureOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('backpressure must be an options object', 'backpressure')
  const highWaterMarkBytes = positiveInteger(value?.highWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.highWaterMarkBytes, 'backpressure.highWaterMarkBytes')
  const lowWaterMarkBytes = positiveNumber(value?.lowWaterMarkBytes ?? DEFAULT_BACKPRESSURE_OPTIONS.lowWaterMarkBytes, 'backpressure.lowWaterMarkBytes', true)
  if (lowWaterMarkBytes >= highWaterMarkBytes)
    throw invalidOptions('backpressure.lowWaterMarkBytes must be lower than highWaterMarkBytes', 'backpressure.lowWaterMarkBytes')
  return Object.freeze({ highWaterMarkBytes, lowWaterMarkBytes })
}

function normalizeLease(value: Partial<LeaseOptions> | undefined): Readonly<LeaseOptions> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('lease must be an options object', 'lease')
  const interval = positiveNumber(value?.interval ?? DEFAULT_LEASE_OPTIONS.interval, 'lease.interval')
  const timeout = positiveNumber(value?.timeout ?? DEFAULT_LEASE_OPTIONS.timeout, 'lease.timeout')
  if (timeout <= interval)
    throw invalidOptions('lease.timeout must be greater than lease.interval', 'lease.timeout')
  return Object.freeze({ interval, timeout })
}

function normalizeLimits(value: Partial<ResourceLimits> | undefined): Readonly<ResourceLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw invalidOptions('limits must be an options object', 'limits')
  return Object.freeze({
    maxClientsPerConnection: positiveInteger(value?.maxClientsPerConnection ?? DEFAULT_RESOURCE_LIMITS.maxClientsPerConnection, 'limits.maxClientsPerConnection'),
    maxControlEnvelopeBytes: positiveInteger(value?.maxControlEnvelopeBytes ?? DEFAULT_RESOURCE_LIMITS.maxControlEnvelopeBytes, 'limits.maxControlEnvelopeBytes'),
    maxEncodedMessageBytes: positiveInteger(value?.maxEncodedMessageBytes ?? DEFAULT_RESOURCE_LIMITS.maxEncodedMessageBytes, 'limits.maxEncodedMessageBytes'),
    maxPortsPerWorker: positiveInteger(value?.maxPortsPerWorker ?? DEFAULT_RESOURCE_LIMITS.maxPortsPerWorker, 'limits.maxPortsPerWorker'),
    unattachedPortTimeoutMs: positiveNumber(value?.unattachedPortTimeoutMs ?? DEFAULT_RESOURCE_LIMITS.unattachedPortTimeoutMs, 'limits.unattachedPortTimeoutMs'),
  })
}

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

function normalizeProtocol<Incoming, Outgoing, Auth>(
  protocol: CreateWebSocketOptions<Incoming, Outgoing, Auth>['protocol'],
): { descriptor: NormalizedProtocolDescriptor, adapter: ProtocolAdapter<Incoming, Outgoing, Auth> | null } {
  if (protocol === undefined || protocol === 'raw')
    return { adapter: null, descriptor: getProtocolDescriptor('raw') }

  if (typeof protocol !== 'object' || protocol === null)
    throw invalidOptions('protocol must be raw, JSON options, or a protocol adapter', 'protocol')

  if ('type' in protocol && protocol.type === 'json') {
    const adapter = createJsonProtocolAdapter(protocol as JsonProtocolOptions) as unknown as ProtocolAdapter<Incoming, Outgoing, Auth>
    return { adapter, descriptor: getProtocolDescriptor(protocol as JsonProtocolOptions) }
  }

  validateProtocolAdapter(protocol)
  const adapter = protocol as ProtocolAdapter<Incoming, Outgoing, Auth>
  const sharedConfig = adapter.sharedConfig ?? {}
  assertStructuredCloneable(sharedConfig, 'protocol.sharedConfig')
  return {
    adapter,
    descriptor: Object.freeze({
      capabilities: Object.freeze({ ...adapter.capabilities }),
      id: adapter.id,
      kind: 'custom',
      readyWhen: adapter.readyWhen ?? 'socket-open',
      sharedConfig,
      version: adapter.version,
    }),
  }
}

export function normalizeWebSocketOptions<Incoming = SocketData, Outgoing = SocketData, Auth = unknown>(
  url: string | URL,
  options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
): NormalizedWebSocketConfig<Incoming, Outgoing, Auth> {
  if (options === null || typeof options !== 'object')
    throw invalidOptions('options must be an object', 'options')
  if (typeof options.id !== 'string' || options.id.trim().length === 0)
    throw invalidOptions('id must be a non-empty string', 'id')
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
    heartbeat: normalizeHeartbeat(options.heartbeat),
    idleGraceMs: positiveNumber(options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS, 'idleGraceMs', true),
    lease: normalizeLease(options.lease),
    limits: normalizeLimits(options.limits),
    protocol: descriptor,
    protocols: normalizeProtocols(options.protocols),
    queue: normalizeQueue(options.queue),
    reconnect: normalizeReconnect(options.autoReconnect),
  })
  if (shared.heartbeat !== false && !descriptor.capabilities.heartbeat)
    throw invalidOptions('heartbeat requires a protocol with heartbeat capability', 'heartbeat')

  const configCanonical = stableSerialize(shared)
  return Object.freeze({
    adapter: adapter ?? rawProtocol as unknown as ProtocolAdapter<Incoming, Outgoing, Auth>,
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
    url: normalizeUrl(url),
  })
}

export function hasConfigConflict(
  current: Pick<NormalizedWebSocketConfig<unknown, unknown, unknown>, 'configCanonical'>,
  incoming: Pick<NormalizedWebSocketConfig<unknown, unknown, unknown>, 'configCanonical'>,
): boolean {
  return current.configCanonical !== incoming.configCanonical
}

export function isValidAdapterId(value: string): boolean {
  return adapterIdPattern.test(value)
}
