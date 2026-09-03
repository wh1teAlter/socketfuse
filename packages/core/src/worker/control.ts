/** 定义 page-to-Worker 控制消息、响应消息和严格的运行时解析器。 */
import type { ClientVisibility, ConnectionDiagnostics, ConnectionSnapshot, NormalizedRestoreOptions, SendOptions, SendReceipt, SocketData } from '../shared/types'
import type { SharedConnectionConfig } from '../config/normalize'
import type { ReconnectPlan } from '../connection/controller'
import { isSocketFuseErrorCode, type SocketFuseErrorCode } from '../shared/errors'
import { MAX_ENDPOINT_LENGTH } from '../shared/constants'
import { isPlainRecord } from '../shared/structured'

export interface ControlError {
  /** 稳定错误码；不携带原始异常文本。 */
  readonly code: SocketFuseErrorCode
  /** 当前操作是否可重试。 */
  readonly retryable: boolean
  /** 是否进入终态。 */
  readonly fatal: boolean
}

export interface HelloRequest {
  /** 控制消息类型。 */
  readonly type: 'hello'
  /** page/Worker 控制协议主版本。 */
  readonly protocolMajor: number
  /** 用于匹配响应的页面请求 id。 */
  readonly requestId: string
  /** 当前页面逻辑 client id。 */
  readonly clientId: string
  /** 共享连接业务 identity。 */
  readonly id: string
  /** 当前 endpoint 绝对 URL。 */
  readonly url: string
  /** 共享配置 canonical。 */
  readonly configCanonical: string
  /** canonical 的稳定 fingerprint。 */
  readonly configFingerprint: string
  /** Worker 需要重建的共享配置。 */
  readonly shared: SharedConnectionConfig
  /** 页面本地 restore 配置的 Worker 副本。 */
  readonly restore: NormalizedRestoreOptions
  /** hello 时页面最近的执行活性。 */
  readonly visibility: ClientVisibility
}

/** page-to-Worker 的请求与生命周期操作联合类型。 */
export type ClientOperation
  = | { readonly type: 'open', readonly requestId: string }
    | { readonly type: 'close', readonly requestId: string }
    | { readonly type: 'send', readonly requestId: string, readonly data: unknown, readonly options?: SendOptions }
    | { readonly type: 'register-key', readonly requestId: string, readonly key: string }
    | { readonly type: 'unregister-key', readonly requestId: string, readonly key: string }
    | { readonly type: 'set-reconnect-hook', readonly requestId: string, readonly enabled: boolean }
    | { readonly type: 'complete-reconnect-plan', readonly requestId: string, readonly planId: string, readonly url?: string, readonly delay?: number }
    | { readonly type: 'reject-reconnect-plan', readonly requestId: string, readonly planId: string }
    | { readonly type: 'reconnect', readonly requestId: string }
    | { readonly type: 'diagnostics', readonly requestId: string }
    | { readonly type: 'dispose', readonly requestId: string }
    | { readonly type: 'probe', readonly requestId: string }
    | { readonly type: 'receipt', readonly deliveryId: number }
    | { readonly type: 'lease' }
    | { readonly type: 'suspend' }
    | { readonly type: 'restore' }
    | { readonly type: 'visibility', readonly visibility: ClientVisibility }

/** 所有页面发往 Worker 的控制消息。 */
export type ClientControlMessage = HelloRequest | ClientOperation

/** Worker 响应 request 的允许值集合。 */
export type ControlResponseValue = ConnectionDiagnostics | ConnectionSnapshot | SendReceipt | { readonly attached: true, readonly workerInstanceId: string } | null

/** Worker 主动派发给页面的事件与请求响应联合类型。 */
export type WorkerControlMessage
  = | { readonly type: 'response', readonly requestId: string, readonly ok: true, readonly value: ControlResponseValue }
    | { readonly type: 'response', readonly requestId: string, readonly ok: false, readonly error: ControlError }
    | { readonly type: 'state', readonly snapshot: ConnectionSnapshot, readonly reasonCode?: string }
    | { readonly type: 'open', readonly snapshot: ConnectionSnapshot }
    | { readonly type: 'message', readonly data: unknown, readonly deliveryId: number, readonly receivedAt: number, readonly replayed: boolean }
    | { readonly type: 'close', readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }
    | { readonly type: 'error', readonly error: ControlError }
    | { readonly type: 'overflow', readonly direction: 'inbound' | 'replay', readonly droppedMessages: number, readonly droppedBytes: number }
    | { readonly type: 'key-granted', readonly key: string }
    | { readonly type: 'key-revoked', readonly key: string }
    | { readonly type: 'before-reconnect', readonly plan: ReconnectPlan }
    | { readonly type: 'abort-reconnect', readonly planId: string }

/** 严格比较控制 envelope 的必需和可选字段，拒绝未知字段。 */
function exactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every(key => key in record) && Object.keys(record).every(key => allowed.has(key))
}

/** 判断值是否为正安全整数。 */
function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** 判断值是否为正有限数。 */
function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/** 判断值是否为非负有限数。 */
function nonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** 限制控制协议字符串长度，避免异常 envelope 占用无限内存。 */
function shortString(value: unknown, maximum = 4_096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
}

/** 判断值是否能作为同步 fingerprint 的 raw 心跳 payload。 */
function isHeartbeatPayload(value: unknown): boolean {
  return typeof value === 'string'
    || value instanceof ArrayBuffer
    || ArrayBuffer.isView(value)
}

/** 校验 Worker 侧 restore 配置及其有界回放约束。 */
function isRestore(value: unknown): value is NormalizedRestoreOptions {
  if (!isPlainRecord(value) || !exactKeys(value, ['enabled', 'replay', 'maxMessages', 'maxBytes']))
    return false
  return typeof value.enabled === 'boolean'
    && typeof value.replay === 'boolean'
    && positiveInteger(value.maxMessages)
    && positiveInteger(value.maxBytes)
    && (value.enabled || value.replay === false)
}

/** 校验共享配置的字段与单位。 */
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
    if (!isPlainRecord(value.reconnect) || !exactKeys(value.reconnect, ['retries', 'initialDelay', 'maxDelay', 'factor', 'jitter', 'stableThreshold', 'hookTimeout']))
      return false
    if (typeof value.reconnect.retries !== 'number' || value.reconnect.retries < 0
      || (!Number.isSafeInteger(value.reconnect.retries) && value.reconnect.retries !== Number.POSITIVE_INFINITY)
      || !nonNegativeFinite(value.reconnect.initialDelay) || !nonNegativeFinite(value.reconnect.maxDelay)
      || !positiveFinite(value.reconnect.factor) || !nonNegativeFinite(value.reconnect.jitter)
      || value.reconnect.jitter > 1 || !nonNegativeFinite(value.reconnect.stableThreshold)
      || !positiveFinite(value.reconnect.hookTimeout)) {
      return false
    }
  }
  if (value.heartbeat !== false) {
    if (!isPlainRecord(value.heartbeat) || !exactKeys(value.heartbeat, ['mode', 'interval'], ['pongTimeout', 'message', 'responseMessage'])
      || (value.heartbeat.mode !== 'pong' && value.heartbeat.mode !== 'activity')
      || !positiveFinite(value.heartbeat.interval) || (value.heartbeat.pongTimeout !== undefined && !positiveFinite(value.heartbeat.pongTimeout))) {
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
  if (!isPlainRecord(value.protocol) || !exactKeys(value.protocol, ['kind', 'id', 'version', 'sharedConfig'])
    || !['raw', 'json', 'custom'].includes(value.protocol.kind as string)
    || typeof value.protocol.id !== 'string' || !positiveInteger(value.protocol.version)
    || !isPlainRecord(value.protocol.sharedConfig)) {
    return false
  }
  const hasRawMessage = Object.prototype.hasOwnProperty.call(value.heartbeat, 'message')
  const hasRawResponse = Object.prototype.hasOwnProperty.call(value.heartbeat, 'responseMessage')
  if (value.heartbeat !== false && (value.protocol.kind === 'raw'
    ? (!hasRawMessage || !hasRawResponse || !isHeartbeatPayload(value.heartbeat.message) || !isHeartbeatPayload(value.heartbeat.responseMessage))
    : (hasRawMessage || hasRawResponse))) {
    return false
  }
  return true
}

/** 校验 send 的页面本地选项。 */
function isSendOptions(value: unknown): value is SendOptions {
  if (!isPlainRecord(value) || !exactKeys(value, [], ['queue']))
    return false
  return value.queue === undefined || typeof value.queue === 'boolean'
}

/** 解析页面控制消息，拒绝未知字段、非法值和超长字符串。 */
export function isClientControlMessage(value: unknown): value is ClientControlMessage {
  if (!isPlainRecord(value))
    return false
  const record = value
  if (typeof record.type !== 'string')
    return false
  if (record.type === 'lease' || record.type === 'suspend' || record.type === 'restore')
    return exactKeys(record, ['type'])
  if (record.type === 'visibility')
    return exactKeys(record, ['type', 'visibility']) && (record.visibility === 'visible' || record.visibility === 'hidden' || record.visibility === 'frozen')
  if (record.type === 'receipt')
    return exactKeys(record, ['type', 'deliveryId']) && positiveInteger(record.deliveryId)
  if (!shortString(record.requestId, 256))
    return false
  if (record.type === 'hello') {
    return exactKeys(record, ['type', 'protocolMajor', 'requestId', 'clientId', 'id', 'url', 'configCanonical', 'configFingerprint', 'shared', 'restore', 'visibility'])
      && Number.isSafeInteger(record.protocolMajor)
      && shortString(record.clientId)
      && typeof record.id === 'string'
      && record.id.trim().length > 0
      && record.id.length <= 1_024
      && shortString(record.url, MAX_ENDPOINT_LENGTH)
      && shortString(record.configCanonical, 1_000_000)
      && shortString(record.configFingerprint, 256)
      && isSharedConfig(record.shared)
      && isRestore(record.restore)
      && (record.visibility === 'visible' || record.visibility === 'hidden' || record.visibility === 'frozen')
  }
  if (record.type === 'open' || record.type === 'close' || record.type === 'diagnostics' || record.type === 'dispose' || record.type === 'probe')
    return exactKeys(record, ['type', 'requestId'])
  if (record.type === 'send')
    return exactKeys(record, ['type', 'requestId', 'data'], ['options']) && (record.options === undefined || isSendOptions(record.options))
  if (record.type === 'register-key' || record.type === 'unregister-key')
    return exactKeys(record, ['type', 'requestId', 'key']) && shortString(record.key, 1_024)
  if (record.type === 'set-reconnect-hook')
    return exactKeys(record, ['type', 'requestId', 'enabled']) && typeof record.enabled === 'boolean'
  if (record.type === 'reject-reconnect-plan')
    return exactKeys(record, ['type', 'requestId', 'planId']) && shortString(record.planId, 256)
  if (record.type === 'complete-reconnect-plan')
    return exactKeys(record, ['type', 'requestId', 'planId'], ['url', 'delay'])
      && shortString(record.planId, 256)
      && (record.url === undefined || shortString(record.url, MAX_ENDPOINT_LENGTH))
      && (record.delay === undefined || nonNegativeFinite(record.delay))
  if (record.type === 'reconnect')
    return exactKeys(record, ['type', 'requestId'])
  return false
}

/** 判断未知值是否为连接生命周期状态。 */
const isConnectionState = (value: unknown): boolean =>
  typeof value === 'string' && ['idle', 'connecting', 'open', 'reconnecting', 'closing', 'closed', 'failed'].includes(value)

/** 校验 Worker 返回的连接快照。 */
const isSnapshot = (value: unknown): value is ConnectionSnapshot =>
  isPlainRecord(value) && exactKeys(value, ['state', 'status', 'readyState', 'transport', 'attempt', 'connectedAt'])
  && isConnectionState(value.state)
  && ['OPEN', 'CONNECTING', 'CLOSED'].includes(value.status as string)
  && [0, 1, 2, 3].includes(value.readyState as number)
  && ['direct', 'shared-worker'].includes(value.transport as string)
  && Number.isSafeInteger(value.attempt) && (value.attempt as number) >= 0 && nonNegativeFinite(value.connectedAt)

/** 校验不含 message/cause 的跨端口错误结构。 */
const isControlError = (value: unknown): value is ControlError =>
  isPlainRecord(value) && exactKeys(value, ['code', 'retryable', 'fatal'])
  && isSocketFuseErrorCode(value.code) && typeof value.retryable === 'boolean' && typeof value.fatal === 'boolean'

/** 校验 accepted 或 queued 的本地发送回执。 */
const isSendReceipt = (value: unknown): value is SendReceipt => {
  if (!isPlainRecord(value) || typeof value.status !== 'string' || !shortString(value.messageId, 256))
    return false
  if (value.status === 'accepted')
    return exactKeys(value, ['status', 'messageId', 'bufferedAmount']) && nonNegativeFinite(value.bufferedAmount)
  return value.status === 'queued' && exactKeys(value, ['status', 'messageId', 'position']) && positiveInteger(value.position)
}

/** 校验已脱敏的连接诊断快照。 */
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
  && (value.lastErrorCode === null || isSocketFuseErrorCode(value.lastErrorCode))

/** 校验 Worker request 的响应 payload。 */
const isControlResponseValue = (value: unknown): value is ControlResponseValue =>
  value === null || isSnapshot(value) || isDiagnostics(value) || isSendReceipt(value)
  || (isPlainRecord(value) && exactKeys(value, ['attached', 'workerInstanceId'])
    && value.attached === true && shortString(value.workerInstanceId, 256))

/** 解析 Worker 派发消息，确保页面只处理受控结构。 */
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
  if (record.type === 'key-granted' || record.type === 'key-revoked')
    return exactKeys(record, ['type', 'key']) && shortString(record.key, 1_024)
  if (record.type === 'abort-reconnect')
    return exactKeys(record, ['type', 'planId']) && shortString(record.planId, 256)
  if (record.type === 'before-reconnect') {
    if (!exactKeys(record, ['type', 'plan']) || !isPlainRecord(record.plan))
      return false
    const plan = record.plan
    return exactKeys(plan, ['id', 'attempt', 'defaultDelay', 'reason', 'close'])
      && shortString(plan.id, 256)
      && positiveInteger(plan.attempt)
      && nonNegativeFinite(plan.defaultDelay)
      && (plan.reason === 'explicit' || plan.reason === 'socket-close' || plan.reason === 'socket-error' || plan.reason === 'connection-timeout' || plan.reason === 'heartbeat-timeout')
      && isPlainRecord(plan.close)
      && exactKeys(plan.close, ['code', 'wasClean', 'terminal'])
      && Number.isSafeInteger(plan.close.code) && (plan.close.code as number) >= 0 && (plan.close.code as number) <= 65_535
      && typeof plan.close.wasClean === 'boolean' && typeof plan.close.terminal === 'boolean'
  }
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
