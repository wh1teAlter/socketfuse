/** 统一两种接入位置的端口控制协议；握手不拥有连接，参与期与每个控制输入均严格校验。 */
import type { ClientVisibility, ConnectionDiagnostics, ConnectionSnapshot, NormalizedRestoreOptions, SendOptions, SendReceipt, WorkerResourceLimits } from '../shared/types'
import type { ReconnectObservation, ReconnectPlan } from '../connection/controller'
import { isSharedConnectionConfig, type SharedConnectionConfig } from '../config/normalize'
import { isSocketFuseErrorCode, type SocketFuseErrorCode } from '../shared/errors'
import { MAX_ENDPOINT_LENGTH } from '../shared/constants'
import { isPlainRecord } from '../shared/structured'

/** 原生 MessagePort 的可测试最小能力面。 */
export interface MessagePortLike {
  /** 结构化克隆发送。 */
  postMessage: (message: unknown) => void
  /** 启动原生消息事件。 */
  start?: () => void
  /** 关闭端口。 */
  close?: () => void
  /** 注册消息或解析失败。 */
  addEventListener: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** 解除注册。 */
  removeEventListener: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void

}

/** 唯一允许跨控制边界的错误字段。 */
export interface ControlError {
  /** 稳定错误码。 */
  readonly code: SocketFuseErrorCode
  /** 当前失败是否可能通过其他尝试恢复。 */
  readonly retryable: boolean
  /** 当前条目是否进入不可恢复终态。 */
  readonly fatal: boolean
}

/** 版本握手仅协商能力，不接触连接池或业务配置。 */
export interface HelloRequest {
  /** 握手类型。 */
  readonly type: 'hello'
  /** 短请求身份。 */
  readonly requestId: string
  /** 控制协议主版本。 */
  readonly protocolMajor: number
}

/** 通过握手之后才提交的一次参与意图。 */
export interface AttachRequest {
  /** 附着类型。 */
  readonly type: 'attach'
  /** 短请求身份。 */
  readonly requestId: string
  /** 不可复用的端口参与期身份。 */
  readonly sessionId: string
  /** 应用共享 identity。 */
  readonly id: string
  /** 初始 endpoint，只允许作为输入而不回传。 */
  readonly url: string
  /** 已完整规范化的共享字段。 */
  readonly shared: SharedConnectionConfig
  /** 与共享字段一致的完整 canonical。 */
  readonly configCanonical: string
  /** 当前参与者回放限制。 */
  readonly restore: NormalizedRestoreOptions
  /** 当前页面活性。 */
  readonly visibility: ClientVisibility
  /** 本参与期重新注册的有界分派 key。 */
  readonly dispatchKeys: readonly string[]
  /** 是否注册了页面准备 hook。 */
  readonly reconnectHook: boolean
}

/** 附着之后的控制输入；所有输入均绑定当前端口参与期。 */
export type ClientOperation = { readonly sessionId: string } & (
  | { readonly type: 'demand' | 'detach' | 'diagnostics', readonly requestId: string }
  | { readonly type: 'send', readonly requestId: string, readonly data: unknown, readonly options?: SendOptions }
  | { readonly type: 'register-key' | 'unregister-key', readonly requestId: string, readonly key: string }
  | { readonly type: 'set-reconnect-hook', readonly requestId: string, readonly enabled: boolean }
  | { readonly type: 'reconnect', readonly requestId: string, readonly observed: ReconnectObservation, readonly countAsRetry: boolean }
  | { readonly type: 'complete-reconnect-plan', readonly requestId: string, readonly planId: string, readonly url?: string, readonly delay?: number }
  | { readonly type: 'reject-reconnect-plan', readonly requestId: string, readonly planId: string }
  | { readonly type: 'lease', readonly sequence: number }
  | { readonly type: 'receipt', readonly deliveryId: number }
  | { readonly type: 'suspend' | 'restore' }
  | { readonly type: 'visibility', readonly visibility: ClientVisibility }
)

/** 所有页面到 runtime 的消息。 */
export type ClientControlMessage = HelloRequest | AttachRequest | ClientOperation

/** 每帧固定的分派资格；session 和 epoch 由外层 envelope 携带。 */
export interface DispatchStamp {
  /** 业务分派身份。 */
  readonly key: string
  /** 当前连接内不复用的授权代际。 */
  readonly generation: number
}

/** 成功握手后报告 runtime 实际静态能力。 */
export interface Welcome {
  /** 握手响应标签。 */
  readonly kind: 'welcome'
  /** 本 runtime 实例身份，仅用于控制关联。 */
  readonly instanceId: string
  /** 已协商版本。 */
  readonly protocolMajor: number
  /** runtime 静态限制，页面在后续 post 前使用。 */
  readonly limits: WorkerResourceLimits
}

/** attach 和 demand 都立即确认当前安全状态，不等待网络打开。 */
export interface Attached {
  /** 状态确认标签。 */
  readonly kind: 'attached'
  /** 已提交的参与期身份。 */
  readonly sessionId: string
  /** 当前版本快照。 */
  readonly snapshot: ConnectionSnapshot
  /** 当前安全诊断。 */
  readonly diagnostics: ConnectionDiagnostics
}

/** 成功短请求允许的回复表示。 */
export type ControlResponseValue = Welcome | Attached | ConnectionDiagnostics | SendReceipt | null

/** runtime 到页面的请求回复、权威状态和有界消息。 */
export type WorkerControlMessage
  = | { readonly type: 'response', readonly requestId: string, readonly ok: true, readonly value: ControlResponseValue }
    | { readonly type: 'response', readonly requestId: string, readonly ok: false, readonly error: ControlError }
    | ({ readonly sessionId: string } & (
      | { readonly type: 'state' | 'open', readonly snapshot: ConnectionSnapshot, readonly reasonCode?: SocketFuseErrorCode }
      | { readonly type: 'message', readonly connectionEpoch: string, readonly data: unknown, readonly deliveryId: number, readonly receivedAt: number, readonly replayed: boolean, readonly dispatch: readonly DispatchStamp[] }
      | { readonly type: 'close', readonly attempt: number, readonly connectionEpoch: string, readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }
      | { readonly type: 'error', readonly error: ControlError }
      | { readonly type: 'overflow', readonly direction: 'inbound' | 'replay', readonly strategy: 'drop-oldest' | 'drop-newest', readonly droppedMessages: number, readonly droppedBytes: number }
      | { readonly type: 'key-granted', readonly connectionEpoch: string, readonly key: string, readonly generation: number }
      | { readonly type: 'key-revoked', readonly key: string }
      | { readonly type: 'lease-confirmed', readonly sequence: number, readonly connectionEpoch: string, readonly grants: readonly DispatchStamp[] }
      | { readonly type: 'before-reconnect', readonly plan: ReconnectPlan }
      | { readonly type: 'abort-reconnect', readonly planId: string }
  ))

/** 严格的必需/可选字段检查，不调用 accessor 取值。 */
export function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  return isPlainRecord(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => (required.includes(key) || optional.includes(key)) && 'value' in (Object.getOwnPropertyDescriptor(value, key) ?? {}))
}

/** 控制 identity 的长度边界。 */
function identity(value: unknown, limit = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
}

/** 非负有限安全整数。 */
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
}

/** 平台定时器毫秒约束。 */
function milliseconds(value: unknown): value is number {
  return integer(value) && value <= 2_147_483_647
}

/** 页面活性枚举。 */
function visibility(value: unknown): value is ClientVisibility {
  return value === 'visible' || value === 'hidden' || value === 'frozen'
}

/** 参与者 restore 配置是完整值，不在 runtime 补默认。 */
function restoreConfig(value: unknown): value is NormalizedRestoreOptions {
  return exactKeys(value, ['enabled', 'replay', 'maxMessages', 'maxBytes'])
    && typeof value.enabled === 'boolean' && typeof value.replay === 'boolean'
    && (value.enabled || !value.replay) && integer(value.maxMessages, 1) && integer(value.maxBytes, 1)
}

/** 验证 raw page 控制输入；runtime 另在调用前验证参与期与资源预算。 */
export function isClientControlMessage(value: unknown): value is ClientControlMessage {
  try {
    if (!isPlainRecord(value))
      return false
    if (value.type === 'hello')
      return exactKeys(value, ['type', 'requestId', 'protocolMajor']) && identity(value.requestId) && integer(value.protocolMajor, 1)
    if (!identity(value.sessionId))
      return false
    if (value.type === 'attach')
      return exactKeys(value, ['type', 'requestId', 'sessionId', 'id', 'url', 'shared', 'configCanonical', 'restore', 'visibility', 'dispatchKeys', 'reconnectHook'])
        && identity(value.requestId) && identity(value.id, 1024) && (value.id as string).trim().length > 0
        && identity(value.url, MAX_ENDPOINT_LENGTH) && identity(value.configCanonical, 1_000_000)
        && isSharedConnectionConfig(value.shared) && restoreConfig(value.restore) && visibility(value.visibility)
        && typeof value.reconnectHook === 'boolean' && Array.isArray(value.dispatchKeys) && value.dispatchKeys.length <= 1024
        && value.dispatchKeys.every(key => identity(key, 1024)) && new Set(value.dispatchKeys).size === value.dispatchKeys.length
    const base = ['type', 'sessionId']
    if (value.type === 'lease')
      return exactKeys(value, [...base, 'sequence']) && integer(value.sequence, 1)
    if (value.type === 'receipt')
      return exactKeys(value, [...base, 'deliveryId']) && integer(value.deliveryId, 1)
    if (value.type === 'suspend' || value.type === 'restore')
      return exactKeys(value, base)
    if (value.type === 'visibility')
      return exactKeys(value, [...base, 'visibility']) && visibility(value.visibility)
    if (!identity(value.requestId))
      return false
    const request = [...base, 'requestId']
    switch (value.type) {
      case 'demand': case 'detach': case 'diagnostics':
        return exactKeys(value, request)
      case 'send':
        return exactKeys(value, [...request, 'data'], ['options'])
          && (value.options === undefined || (exactKeys(value.options, [], ['queue']) && (value.options.queue === undefined || typeof value.options.queue === 'boolean')))
      case 'register-key': case 'unregister-key':
        return exactKeys(value, [...request, 'key']) && identity(value.key, 1024)
      case 'set-reconnect-hook':
        return exactKeys(value, [...request, 'enabled']) && typeof value.enabled === 'boolean'
      case 'reconnect':
        return exactKeys(value, [...request, 'observed', 'countAsRetry']) && typeof value.countAsRetry === 'boolean'
          && exactKeys(value.observed, ['connectionEpoch', 'attempt', 'planId']) && identity(value.observed.connectionEpoch)
          && integer(value.observed.attempt) && (value.observed.planId === null || identity(value.observed.planId))
      case 'complete-reconnect-plan':
        return exactKeys(value, [...request, 'planId'], ['url', 'delay']) && identity(value.planId)
          && (value.url === undefined || identity(value.url, MAX_ENDPOINT_LENGTH)) && (value.delay === undefined || milliseconds(value.delay))
      case 'reject-reconnect-plan':
        return exactKeys(value, [...request, 'planId']) && identity(value.planId)
      default:
        return false
    }
  }
  catch {
    return false
  }
}

/** 安全错误形状，不允许附加原始 message/details/cause。 */
function controlError(value: unknown): value is ControlError {
  return exactKeys(value, ['code', 'fatal', 'retryable']) && isSocketFuseErrorCode(value.code)
    && typeof value.fatal === 'boolean' && typeof value.retryable === 'boolean'
}

/** 已规范化静态能力，welcome 不得静默丢掉限制字段。 */
export function isResourceLimits(value: unknown): value is WorkerResourceLimits {
  return exactKeys(value, ['maxPorts', 'maxControlEnvelopeBytes', 'unattachedPortTimeoutMs', 'maxDispatchKeys', 'maxDeliveryMessages', 'maxDeliveryBytes'])
    && Object.values(value).every(item => integer(item, 1)) && milliseconds(value.unattachedPortTimeoutMs)
}

/** 验证状态快照的枚举、身份与单调值范围。 */
export function isConnectionSnapshot(value: unknown): value is ConnectionSnapshot {
  return exactKeys(value, ['state', 'status', 'readyState', 'transport', 'connectionEpoch', 'attempt', 'revision', 'planId', 'connectedAt'])
    && ['idle', 'connecting', 'open', 'reconnecting', 'closing', 'closed', 'failed'].includes(String(value.state))
    && ['OPEN', 'CONNECTING', 'CLOSED'].includes(String(value.status)) && integer(value.readyState) && value.readyState <= 3
    && ['pending', 'shared-worker', 'direct'].includes(String(value.transport)) && identity(value.connectionEpoch)
    && integer(value.attempt) && integer(value.revision) && (value.planId === null || identity(value.planId)) && integer(value.connectedAt)
}

/** 验证安全诊断字段集合，不接受任意字符串字典或异常文本。 */
export function isConnectionDiagnostics(value: unknown): value is ConnectionDiagnostics {
  if (!exactKeys(value, ['transport', 'workerInstanceHash', 'logicalState', 'physicalState', 'connectionEpoch', 'attempt', 'observedAt', 'controlProtocolMajor', 'idHash', 'configFingerprint', 'endpointOrigin', 'retriesUsed', 'retriesRemaining', 'retryReserved', 'nextRetryDelay', 'lastSafeCloseCode', 'attachedClientCount', 'queueMessages', 'queueBytes', 'bufferedAmount', 'outboundHighWater', 'lastErrorCode']))
    return false
  return ['pending', 'shared-worker', 'direct'].includes(String(value.transport)) && identity(value.connectionEpoch)
    && ['attempt', 'observedAt', 'controlProtocolMajor', 'retriesUsed', 'retryReserved', 'attachedClientCount', 'queueMessages', 'queueBytes', 'bufferedAmount'].every(key => integer(value[key]))
    && (value.retriesRemaining === Infinity || integer(value.retriesRemaining)) && (value.retryReserved === 0 || value.retryReserved === 1)
    && (value.nextRetryDelay === null || milliseconds(value.nextRetryDelay)) && (value.lastSafeCloseCode === null || integer(value.lastSafeCloseCode))
    && typeof value.outboundHighWater === 'boolean' && (value.lastErrorCode === null || isSocketFuseErrorCode(value.lastErrorCode))
    && typeof value.endpointOrigin === 'string' && (value.endpointOrigin === '' || new URL(value.endpointOrigin).origin === value.endpointOrigin)
    && [value.idHash, value.configFingerprint].every(item => typeof item === 'string' && /^socketfuse1-[a-f0-9]{8}$/.test(item))
    && (value.workerInstanceHash === null || (typeof value.workerInstanceHash === 'string' && /^socketfuse1-[a-f0-9]{8}$/.test(value.workerInstanceHash)))
    && [value.logicalState, value.physicalState].every(state => ['idle', 'connecting', 'open', 'reconnecting', 'closing', 'closed', 'failed'].includes(String(state)))
}

/** 验证一组按连接单调分配的分派资格。 */
function stamps(value: unknown): value is readonly DispatchStamp[] {
  return Array.isArray(value) && value.length <= 1024 && value.every(item => exactKeys(item, ['key', 'generation']) && identity(item.key, 1024) && integer(item.generation, 1))
}

/** 验证不携带 endpoint 的准备描述。 */
function reconnectPlan(value: unknown): value is ReconnectPlan {
  return exactKeys(value, ['id', 'connectionEpoch', 'originAttempt', 'attempt', 'source', 'countAsRetry', 'retriesUsed', 'defaultDelay', 'deadline', 'reason', 'close'])
    && identity(value.id) && identity(value.connectionEpoch) && integer(value.originAttempt) && integer(value.attempt, 1)
    && ['automatic', 'page', 'worker', 'demand'].includes(String(value.source)) && typeof value.countAsRetry === 'boolean'
    && integer(value.retriesUsed) && milliseconds(value.defaultDelay) && integer(value.deadline)
    && ['explicit', 'socket-close', 'socket-error', 'connection-timeout', 'heartbeat-timeout'].includes(String(value.reason))
    && exactKeys(value.close, ['code', 'wasClean', 'terminal']) && integer(value.close.code) && typeof value.close.wasClean === 'boolean' && typeof value.close.terminal === 'boolean'
}

/** 验证短请求的成功结果，send 回执只描述本地接纳。 */
function responseValue(value: unknown): value is ControlResponseValue {
  if (value === null)
    return true
  if (!isPlainRecord(value))
    return false
  if (value.kind === 'welcome')
    return exactKeys(value, ['kind', 'instanceId', 'protocolMajor', 'limits']) && identity(value.instanceId) && integer(value.protocolMajor, 1) && isResourceLimits(value.limits)
  if (value.kind === 'attached')
    return exactKeys(value, ['kind', 'sessionId', 'snapshot', 'diagnostics']) && identity(value.sessionId) && isConnectionSnapshot(value.snapshot) && isConnectionDiagnostics(value.diagnostics)
  if (value.status === 'accepted')
    return exactKeys(value, ['status', 'messageId', 'bufferedAmount']) && identity(value.messageId) && integer(value.bufferedAmount)
  if (value.status === 'queued')
    return exactKeys(value, ['status', 'messageId', 'position']) && identity(value.messageId) && integer(value.position, 1)
  return isConnectionDiagnostics(value)
}

/** 对 Worker/同 realm runtime 的响应同样严格校验，不信任自定义 Worker 的任意记录。 */
export function isWorkerControlMessage(value: unknown): value is WorkerControlMessage {
  try {
    if (!isPlainRecord(value))
      return false
    if (value.type === 'response')
      return identity(value.requestId) && (value.ok === true
        ? exactKeys(value, ['type', 'requestId', 'ok', 'value']) && responseValue(value.value)
        : value.ok === false && exactKeys(value, ['type', 'requestId', 'ok', 'error']) && controlError(value.error))
    if (!identity(value.sessionId))
      return false
    const base = ['type', 'sessionId']
    switch (value.type) {
      case 'state': case 'open':
        return exactKeys(value, [...base, 'snapshot'], ['reasonCode']) && isConnectionSnapshot(value.snapshot) && (value.reasonCode === undefined || isSocketFuseErrorCode(value.reasonCode))
      case 'error':
        return exactKeys(value, [...base, 'error']) && controlError(value.error)
      case 'message':
        return exactKeys(value, [...base, 'connectionEpoch', 'data', 'deliveryId', 'receivedAt', 'replayed', 'dispatch']) && identity(value.connectionEpoch) && integer(value.deliveryId, 1) && integer(value.receivedAt) && typeof value.replayed === 'boolean' && stamps(value.dispatch)
      case 'close':
        return exactKeys(value, [...base, 'attempt', 'connectionEpoch', 'code', 'wasClean', 'terminal', 'willReconnect']) && identity(value.connectionEpoch) && integer(value.attempt) && integer(value.code) && [value.wasClean, value.terminal, value.willReconnect].every(item => typeof item === 'boolean')
      case 'overflow':
        return exactKeys(value, [...base, 'direction', 'strategy', 'droppedMessages', 'droppedBytes']) && ['inbound', 'replay'].includes(String(value.direction)) && ['drop-oldest', 'drop-newest'].includes(String(value.strategy)) && integer(value.droppedMessages) && integer(value.droppedBytes)
      case 'key-granted':
        return exactKeys(value, [...base, 'connectionEpoch', 'key', 'generation']) && identity(value.connectionEpoch) && identity(value.key, 1024) && integer(value.generation, 1)
      case 'key-revoked':
        return exactKeys(value, [...base, 'key']) && identity(value.key, 1024)
      case 'lease-confirmed':
        return exactKeys(value, [...base, 'sequence', 'connectionEpoch', 'grants']) && integer(value.sequence, 1) && identity(value.connectionEpoch) && stamps(value.grants)
      case 'before-reconnect':
        return exactKeys(value, [...base, 'plan']) && reconnectPlan(value.plan)
      case 'abort-reconnect':
        return exactKeys(value, [...base, 'planId']) && identity(value.planId)
      default:
        return false
    }
  }
  catch {
    return false
  }
}

/** 绑定端口事件并返回唯一清理函数，支持原生端口与最小测试替身。 */
export function listenPort(port: MessagePortLike, message: (data: unknown) => void, failed: () => void): () => void {
  const onMessage = (event: { readonly data: unknown }): void => message(event.data)
  const onError = (): void => failed()
  port.addEventListener('message', onMessage)
  port.addEventListener('messageerror', onError)
  port.start?.()
  return () => {
    port.removeEventListener('message', onMessage)
    port.removeEventListener('messageerror', onError)
  }
}
