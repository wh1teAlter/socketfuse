import type { ConnectionDiagnostics, ConnectionSnapshot, NormalizedRestoreOptions, RevisionReceipt, SendOptions, SendReceipt, SocketData } from './types'
import type { SharedConnectionConfig } from './config'
import { isWwsErrorCode, type WwsErrorCode } from './errors'
import { isPlainRecord } from './structured'

export interface ControlError {
  readonly code: WwsErrorCode
  readonly retryable: boolean
  readonly fatal: boolean
}

export interface HelloRequest {
  readonly type: 'hello'
  readonly protocolMajor: number
  readonly requestId: string
  readonly clientId: string
  readonly id: string
  readonly url: string
  readonly configCanonical: string
  readonly configFingerprint: string
  readonly shared: SharedConnectionConfig
  readonly restore: NormalizedRestoreOptions
}

export type ClientOperation
  = | { readonly type: 'open', readonly requestId: string }
    | { readonly type: 'close', readonly requestId: string }
    | { readonly type: 'send', readonly requestId: string, readonly data: unknown, readonly options?: SendOptions }
    | { readonly type: 'update-auth', readonly requestId: string, readonly auth: unknown, readonly revision: number }
    | { readonly type: 'clear-auth', readonly requestId: string, readonly revision: number }
    | { readonly type: 'update-url', readonly requestId: string, readonly url: string, readonly revision: number }
    | { readonly type: 'reconnect', readonly requestId: string, readonly reason?: string }
    | { readonly type: 'diagnostics', readonly requestId: string }
    | { readonly type: 'dispose', readonly requestId: string }
    | { readonly type: 'probe', readonly requestId: string }
    | { readonly type: 'receipt', readonly deliveryId: number }
    | { readonly type: 'lease' }
    | { readonly type: 'suspend' }
    | { readonly type: 'restore' }

export type ClientControlMessage = HelloRequest | ClientOperation

export type ControlResponseValue = ConnectionDiagnostics | ConnectionSnapshot | SendReceipt | RevisionReceipt | { readonly attached: true, readonly workerInstanceId: string } | null

export type WorkerControlMessage
  = | { readonly type: 'response', readonly requestId: string, readonly ok: true, readonly value: ControlResponseValue }
    | { readonly type: 'response', readonly requestId: string, readonly ok: false, readonly error: ControlError }
    | { readonly type: 'state', readonly snapshot: ConnectionSnapshot, readonly reasonCode?: string }
    | { readonly type: 'open', readonly snapshot: ConnectionSnapshot }
    | { readonly type: 'message', readonly data: unknown, readonly deliveryId: number, readonly receivedAt: number, readonly replayed: boolean }
    | { readonly type: 'close', readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }
    | { readonly type: 'error', readonly error: ControlError }
    | { readonly type: 'overflow', readonly direction: 'inbound' | 'replay', readonly droppedMessages: number, readonly droppedBytes: number }

function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => key in record) && Object.keys(record).every(key => allowed.has(key))
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function shortString(value: unknown, maximum = 4_096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

function isSocketData(value: unknown): boolean {
  return typeof value === 'string'
    || (typeof Blob !== 'undefined' && value instanceof Blob)
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
}

function isRestore(value: unknown): value is NormalizedRestoreOptions {
  if (!isPlainRecord(value) || !exactKeys(value, ['enabled', 'replay', 'maxMessages', 'maxBytes']))
    return false
  return typeof value.enabled === 'boolean'
    && typeof value.replay === 'boolean'
    && positiveInteger(value.maxMessages)
    && positiveInteger(value.maxBytes)
    && (value.enabled || value.replay === false)
}

function isSharedConfig(value: unknown): value is SharedConnectionConfig {
  if (!isPlainRecord(value) || !exactKeys(value, [
    'protocols', 'protocol', 'binaryType', 'reconnect', 'connectionTimeout',
    'heartbeat', 'queue', 'backpressure', 'lease', 'limits', 'idleGraceMs',
  ])) {
    return false
  }
  if (!Array.isArray(value.protocols) || !value.protocols.every(item => typeof item === 'string'))
    return false
  if (value.binaryType !== 'arraybuffer' && value.binaryType !== 'blob')
    return false
  if (!positiveInteger(value.connectionTimeout) || !nonNegativeFinite(value.idleGraceMs))
    return false
  if (value.reconnect !== false) {
    if (!isPlainRecord(value.reconnect) || !exactKeys(value.reconnect, ['retries', 'initialDelay', 'maxDelay', 'factor', 'jitter', 'stableThreshold']))
      return false
    if (typeof value.reconnect.retries !== 'number' || value.reconnect.retries < 0
      || (!Number.isSafeInteger(value.reconnect.retries) && value.reconnect.retries !== Number.POSITIVE_INFINITY)
      || !nonNegativeFinite(value.reconnect.initialDelay) || !nonNegativeFinite(value.reconnect.maxDelay)
      || !positiveFinite(value.reconnect.factor) || !nonNegativeFinite(value.reconnect.jitter)
      || value.reconnect.jitter > 1 || !nonNegativeFinite(value.reconnect.stableThreshold)) {
      return false
    }
  }
  if (value.heartbeat !== false) {
    if (!isPlainRecord(value.heartbeat) || !exactKeys(value.heartbeat, ['mode', 'interval', 'pongTimeout', 'message', 'responseMessage'])
      || (value.heartbeat.mode !== 'pong' && value.heartbeat.mode !== 'activity')
      || !positiveFinite(value.heartbeat.interval) || !positiveFinite(value.heartbeat.pongTimeout)
      || !isSocketData(value.heartbeat.message) || !isSocketData(value.heartbeat.responseMessage)) {
      return false
    }
  }
  if (!isPlainRecord(value.queue) || !exactKeys(value.queue, ['whenDisconnected', 'whenBackpressured', 'maxMessages', 'maxBytes'])
    || typeof value.queue.whenDisconnected !== 'boolean' || typeof value.queue.whenBackpressured !== 'boolean'
    || !positiveInteger(value.queue.maxMessages) || !positiveInteger(value.queue.maxBytes)) {
    return false
  }
  if (!isPlainRecord(value.backpressure) || !exactKeys(value.backpressure, ['highWaterMarkBytes', 'lowWaterMarkBytes'])
    || !positiveInteger(value.backpressure.highWaterMarkBytes) || !nonNegativeFinite(value.backpressure.lowWaterMarkBytes)
    || value.backpressure.lowWaterMarkBytes >= value.backpressure.highWaterMarkBytes) {
    return false
  }
  if (!isPlainRecord(value.lease) || !exactKeys(value.lease, ['interval', 'timeout'])
    || !positiveFinite(value.lease.interval) || !positiveFinite(value.lease.timeout)
    || value.lease.timeout <= value.lease.interval) {
    return false
  }
  if (!isPlainRecord(value.limits) || !exactKeys(value.limits, ['maxClientsPerConnection', 'maxEncodedMessageBytes'])
    || !positiveInteger(value.limits.maxClientsPerConnection) || !positiveInteger(value.limits.maxEncodedMessageBytes)) {
    return false
  }
  if (!isPlainRecord(value.protocol) || !exactKeys(value.protocol, ['kind', 'id', 'version', 'capabilities', 'readyWhen', 'sharedConfig'])
    || !['raw', 'json', 'custom'].includes(value.protocol.kind as string)
    || typeof value.protocol.id !== 'string' || !positiveInteger(value.protocol.version)
    || (value.protocol.readyWhen !== 'socket-open' && value.protocol.readyWhen !== 'adapter-frame')
    || !isPlainRecord(value.protocol.capabilities) || !exactKeys(value.protocol.capabilities, ['auth', 'heartbeat', 'binary'])
    || typeof value.protocol.capabilities.auth !== 'boolean' || typeof value.protocol.capabilities.heartbeat !== 'boolean'
    || typeof value.protocol.capabilities.binary !== 'boolean' || !isPlainRecord(value.protocol.sharedConfig)) {
    return false
  }
  return true
}

function isSendOptions(value: unknown): value is SendOptions {
  if (!isPlainRecord(value) || !exactKeys(value, [], ['queue', 'idempotencyKey']))
    return false
  return (value.queue === undefined || typeof value.queue === 'boolean')
    && (value.idempotencyKey === undefined || typeof value.idempotencyKey === 'string')
}

export function isClientControlMessage(value: unknown): value is ClientControlMessage {
  if (!isPlainRecord(value))
    return false
  const record = value
  if (typeof record.type !== 'string')
    return false
  if (record.type === 'lease' || record.type === 'suspend' || record.type === 'restore')
    return exactKeys(record, ['type'])
  if (record.type === 'receipt')
    return exactKeys(record, ['type', 'deliveryId']) && positiveInteger(record.deliveryId)
  if (!shortString(record.requestId, 256))
    return false
  if (record.type === 'hello') {
    return exactKeys(record, ['type', 'protocolMajor', 'requestId', 'clientId', 'id', 'url', 'configCanonical', 'configFingerprint', 'shared', 'restore'])
      && Number.isSafeInteger(record.protocolMajor)
      && shortString(record.clientId)
      && typeof record.id === 'string'
      && record.id.trim().length > 0
      && record.id.length <= 1_024
      && shortString(record.url)
      && shortString(record.configCanonical, 1_000_000)
      && shortString(record.configFingerprint, 256)
      && isSharedConfig(record.shared)
      && isRestore(record.restore)
  }
  if (record.type === 'open' || record.type === 'close' || record.type === 'diagnostics' || record.type === 'dispose' || record.type === 'probe')
    return exactKeys(record, ['type', 'requestId'])
  if (record.type === 'send')
    return exactKeys(record, ['type', 'requestId', 'data'], ['options']) && (record.options === undefined || isSendOptions(record.options))
  if (record.type === 'update-auth')
    return exactKeys(record, ['type', 'requestId', 'auth', 'revision']) && positiveInteger(record.revision)
  if (record.type === 'clear-auth')
    return exactKeys(record, ['type', 'requestId', 'revision']) && positiveInteger(record.revision)
  if (record.type === 'update-url')
    return exactKeys(record, ['type', 'requestId', 'url', 'revision']) && shortString(record.url) && positiveInteger(record.revision)
  if (record.type === 'reconnect')
    return exactKeys(record, ['type', 'requestId'], ['reason']) && (record.reason === undefined || shortString(record.reason))
  return false
}

const isConnectionState = (value: unknown): boolean =>
  typeof value === 'string' && ['idle', 'connecting', 'handshaking', 'open', 'reconnecting', 'closing', 'closed', 'failed'].includes(value)

const isSnapshot = (value: unknown): value is ConnectionSnapshot =>
  isPlainRecord(value) && exactKeys(value, ['state', 'status', 'readyState', 'transport', 'attempt', 'connectedAt'])
  && isConnectionState(value.state)
  && ['OPEN', 'CONNECTING', 'CLOSED'].includes(value.status as string)
  && [0, 1, 2, 3].includes(value.readyState as number)
  && ['direct', 'shared-worker'].includes(value.transport as string)
  && Number.isSafeInteger(value.attempt) && (value.attempt as number) >= 0 && nonNegativeFinite(value.connectedAt)

const isControlError = (value: unknown): value is ControlError =>
  isPlainRecord(value) && exactKeys(value, ['code', 'retryable', 'fatal'])
  && isWwsErrorCode(value.code) && typeof value.retryable === 'boolean' && typeof value.fatal === 'boolean'

const isRevisionReceipt = (value: unknown): value is RevisionReceipt =>
  isPlainRecord(value) && exactKeys(value, ['status', 'revision'])
  && (value.status === 'applied' || value.status === 'stale' || value.status === 'unchanged')
  && positiveInteger(value.revision)

const isSendReceipt = (value: unknown): value is SendReceipt => {
  if (!isPlainRecord(value) || typeof value.status !== 'string' || !shortString(value.messageId, 256))
    return false
  if (value.status === 'accepted')
    return exactKeys(value, ['status', 'messageId', 'bufferedAmount']) && nonNegativeFinite(value.bufferedAmount)
  return value.status === 'queued' && exactKeys(value, ['status', 'messageId', 'position']) && positiveInteger(value.position)
}

const isDiagnostics = (value: unknown): value is ConnectionDiagnostics =>
  isPlainRecord(value) && exactKeys(value, [
    'transport', 'logicalState', 'physicalState', 'workerInstanceHash', 'controlProtocolMajor', 'idHash',
    'configFingerprint', 'endpointOrigin', 'retryAttempt', 'nextRetryDelay', 'lastSafeCloseCode',
    'attachedClientCount', 'queueMessages', 'queueBytes', 'bufferedAmount', 'outboundHighWater', 'lastErrorCode',
  ])
  && ['pending', 'shared-worker', 'direct'].includes(value.transport as string)
  && isConnectionState(value.logicalState) && isConnectionState(value.physicalState)
  && (value.workerInstanceHash === null || shortString(value.workerInstanceHash, 256))
  && Number.isSafeInteger(value.controlProtocolMajor) && (value.controlProtocolMajor as number) > 0
  && typeof value.idHash === 'string' && typeof value.configFingerprint === 'string' && typeof value.endpointOrigin === 'string'
  && Number.isSafeInteger(value.retryAttempt) && (value.retryAttempt as number) >= 0
  && (value.nextRetryDelay === null || nonNegativeFinite(value.nextRetryDelay))
  && (value.lastSafeCloseCode === null || (Number.isSafeInteger(value.lastSafeCloseCode) && (value.lastSafeCloseCode as number) >= 0 && (value.lastSafeCloseCode as number) <= 65_535))
  && Number.isSafeInteger(value.attachedClientCount) && (value.attachedClientCount as number) >= 0
  && Number.isSafeInteger(value.queueMessages) && (value.queueMessages as number) >= 0
  && nonNegativeFinite(value.queueBytes) && nonNegativeFinite(value.bufferedAmount)
  && typeof value.outboundHighWater === 'boolean'
  && (value.lastErrorCode === null || isWwsErrorCode(value.lastErrorCode))

const isControlResponseValue = (value: unknown): value is ControlResponseValue =>
  value === null || isSnapshot(value) || isDiagnostics(value) || isSendReceipt(value) || isRevisionReceipt(value)
  || (isPlainRecord(value) && exactKeys(value, ['attached', 'workerInstanceId'])
    && value.attached === true && shortString(value.workerInstanceId, 256))

export function isWorkerControlMessage(value: unknown): value is WorkerControlMessage {
  if (!isPlainRecord(value))
    return false
  const record = value
  if (record.type === 'message')
    return exactKeys(record, ['type', 'data', 'deliveryId', 'receivedAt', 'replayed'])
      && positiveInteger(record.deliveryId) && nonNegativeFinite(record.receivedAt) && typeof record.replayed === 'boolean'
  if (record.type === 'overflow')
    return exactKeys(record, ['type', 'direction', 'droppedMessages', 'droppedBytes'])
      && (record.direction === 'inbound' || record.direction === 'replay')
      && typeof record.droppedMessages === 'number' && Number.isSafeInteger(record.droppedMessages) && record.droppedMessages >= 0 && nonNegativeFinite(record.droppedBytes)
  if (record.type === 'error')
    return exactKeys(record, ['type', 'error']) && isControlError(record.error)
  if (record.type === 'response') {
    if (!shortString(record.requestId, 256) || typeof record.ok !== 'boolean')
      return false
    return record.ok
      ? exactKeys(record, ['type', 'requestId', 'ok', 'value']) && isControlResponseValue(record.value)
      : exactKeys(record, ['type', 'requestId', 'ok', 'error']) && isControlError(record.error)
  }
  if (record.type === 'state' || record.type === 'open')
    return exactKeys(record, record.type === 'state' ? ['type', 'snapshot'] : ['type', 'snapshot'], record.type === 'state' ? ['reasonCode'] : [])
      && isSnapshot(record.snapshot) && (record.reasonCode === undefined || shortString(record.reasonCode))
  if (record.type === 'close')
    return exactKeys(record, ['type', 'code', 'wasClean', 'terminal', 'willReconnect'])
      && Number.isSafeInteger(record.code) && (record.code as number) >= 0 && (record.code as number) <= 65_535 && typeof record.wasClean === 'boolean'
      && typeof record.terminal === 'boolean' && typeof record.willReconnect === 'boolean'
  return false
}

export type { SocketData }
