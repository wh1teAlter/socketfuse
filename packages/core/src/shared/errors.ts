/**
 * WWS 的稳定错误模型与跨 Worker 脱敏边界。
 *
 * 页面只能依据错误码与安全文本做控制流；adapter、服务端和浏览器原始异常不能跨端口
 * 传播，以免凭据、URL 或内部实现细节进入其他页面或日志。
 */
/** WWS v1 对外稳定的机器可读错误码集合。 */
export const WWS_ERROR_CODES = [
  'INVALID_OPTIONS',
  'ENVIRONMENT_UNSUPPORTED',
  'CLIENT_DISPOSED',
  'CLIENT_DISCONNECTED',
  'ABORTED',
  'WORKER_UNSUPPORTED',
  'WORKER_CONSTRUCTION_FAILED',
  'WORKER_LOAD_FAILED',
  'WORKER_INIT_TIMEOUT',
  'WORKER_DISCONNECTED',
  'PROTOCOL_VERSION_MISMATCH',
  'ADAPTER_NOT_REGISTERED',
  'INVALID_CONTROL_MESSAGE',
  'CONNECTION_CONFIG_CONFLICT',
  'CONNECTION_TIMEOUT',
  'SOCKET_ERROR',
  'CLOSE_NOT_RETRYABLE',
  'RETRY_EXHAUSTED',
  'HEARTBEAT_TIMEOUT',
  'AUTH_FAILED',
  'STALE_REVISION',
  'SEND_WHILE_DISCONNECTED',
  'QUEUE_FULL',
  'QUEUE_BYTES_EXCEEDED',
  'BACKPRESSURE',
  'MESSAGE_TOO_LARGE',
  'RESOURCE_LIMIT_EXCEEDED',
  'ENCODE_FAILED',
  'DECODE_FAILED',
  'PROTOCOL_ERROR',
  'CAPABILITY_UNSUPPORTED',
  'INBOUND_OVERFLOW',
  'INTERNAL_STATE_ERROR',
] as const

/** 所有 WWS 稳定错误码构成的联合类型。 */
export type WwsErrorCode = typeof WWS_ERROR_CODES[number]

/** 用于 O(1) 校验外部控制消息错误码的只读集合。 */
const wwsErrorCodeSet: ReadonlySet<string> = new Set(WWS_ERROR_CODES)

/**
 * 判断未知值是否为 WWS 可公开的稳定错误码。
 *
 * @param value 可能来自 Worker 控制消息的未知值。
 * @returns 是稳定错误码时返回 `true`。
 */
export function isWwsErrorCode(value: unknown): value is WwsErrorCode {
  return typeof value === 'string' && wwsErrorCodeSet.has(value)
}

/** 构造 `WwsError` 时的内部元数据；跨 Worker 前必须经过脱敏。 */
export interface WwsErrorOptions {
  /** 当前失败是否可能通过重试恢复。 */
  retryable?: boolean
  /** 当前失败是否令逻辑 client 进入终态。 */
  fatal?: boolean
  /** 仅含允许公开原始值的附加信息。 */
  details?: Readonly<Record<string, unknown>>
  /** 仅供本地链路排查的原始原因；不得跨端口发送。 */
  cause?: unknown
}

/**
 * 异步操作 reject 与 error callback 使用的错误契约。
 *
 * 调用方必须依据 `code` 而不是匹配 `message`。details 和 cause 在错误跨 Worker
 * 边界或进入页面 callback 前会被移除，维持“不泄露凭据与内部异常”的不变量。
 */
export class WwsError extends Error {
  /** 便于跨 realm 判断的稳定错误名称。 */
  readonly name = 'WwsError' as const
  /** 面向调用方的稳定错误码。 */
  readonly code: WwsErrorCode
  /** 是否允许当前操作自动或手动重试。 */
  readonly retryable: boolean
  /** 是否表示 client 不应再尝试恢复。 */
  readonly fatal: boolean
  /** 本地可选的已脱敏诊断详情。 */
  readonly details: Readonly<Record<string, unknown>> | undefined
  /** 本地原始异常原因；不得序列化到控制协议。 */
  override readonly cause: unknown

  /**
   * 创建本地错误对象。
   *
   * @param code 供调用方分支处理的稳定错误码。
   * @param message 当前 realm 中可读的错误文本。
   * @param options 重试、终态和本地诊断元数据。
   */
  constructor(code: WwsErrorCode, message: string, options: WwsErrorOptions = {}) {
    super(message)
    this.code = code
    this.retryable = options.retryable ?? false
    this.fatal = options.fatal ?? false
    this.details = options.details
    this.cause = options.cause
  }
}

/** 跨端口时唯一允许使用的稳定英文错误文本映射。 */
const SAFE_ERROR_MESSAGES: Readonly<Record<WwsErrorCode, string>> = Object.freeze({
  ABORTED: 'Operation was aborted',
  ADAPTER_NOT_REGISTERED: 'The requested protocol adapter is unavailable in this Worker',
  AUTH_FAILED: 'Authentication failed',
  BACKPRESSURE: 'Socket backpressure limit was reached',
  CAPABILITY_UNSUPPORTED: 'The selected protocol does not support this operation',
  CLIENT_DISCONNECTED: 'Client is disconnected',
  CLIENT_DISPOSED: 'Client has been disposed',
  CLOSE_NOT_RETRYABLE: 'WebSocket closed without retry',
  CONNECTION_CONFIG_CONFLICT: 'Connection id already uses a different shared configuration',
  CONNECTION_TIMEOUT: 'WebSocket connection timed out',
  DECODE_FAILED: 'Protocol message decoding failed',
  ENCODE_FAILED: 'Protocol message encoding failed',
  ENVIRONMENT_UNSUPPORTED: 'A browser page environment is required',
  HEARTBEAT_TIMEOUT: 'Heartbeat timed out',
  INBOUND_OVERFLOW: 'Inbound messages were dropped because the page was too slow',
  INTERNAL_STATE_ERROR: 'Internal connection state error',
  INVALID_CONTROL_MESSAGE: 'Invalid SharedWorker control message',
  INVALID_OPTIONS: 'Invalid WWS options',
  MESSAGE_TOO_LARGE: 'Message exceeds the configured size limit',
  PROTOCOL_ERROR: 'Protocol processing failed',
  PROTOCOL_VERSION_MISMATCH: 'SharedWorker control protocol version mismatch',
  QUEUE_BYTES_EXCEEDED: 'Outbound queue byte limit was reached',
  QUEUE_FULL: 'Outbound queue message limit was reached',
  RESOURCE_LIMIT_EXCEEDED: 'Resource limit was reached',
  RETRY_EXHAUSTED: 'Reconnect retry budget was exhausted',
  SEND_WHILE_DISCONNECTED: 'Cannot send while the connection is disconnected',
  SOCKET_ERROR: 'WebSocket error',
  STALE_REVISION: 'Revision is stale',
  WORKER_CONSTRUCTION_FAILED: 'Unable to construct SharedWorker',
  WORKER_DISCONNECTED: 'SharedWorker is disconnected',
  WORKER_INIT_TIMEOUT: 'SharedWorker initialization timed out',
  WORKER_LOAD_FAILED: 'SharedWorker failed to load',
  WORKER_UNSUPPORTED: 'SharedWorker is unavailable in this environment',
})

/**
 * 返回错误码对应的稳定安全文本。
 *
 * @param code 已校验的 WWS 错误码。
 * @returns 不含 adapter、服务端或浏览器原始文本的错误说明。
 */
export function safeErrorMessage(code: WwsErrorCode): string {
  return SAFE_ERROR_MESSAGES[code]
}

/**
 * 从已验证的控制平面字段构造页面安全错误。
 *
 * @param code Worker 发送的稳定错误码。
 * @param options Worker 声明的重试与终态标记；details 只可含白名单原始值。
 * @returns 不携带原始 cause 的页面安全错误对象。
 */
export function createSafePublicError(
  code: WwsErrorCode,
  options: Pick<WwsErrorOptions, 'details' | 'fatal' | 'retryable'> = {},
): WwsError {
  return new WwsError(code, safeErrorMessage(code), options)
}

/**
 * 将本地错误裁剪为可跨端口的安全形式。
 *
 * @param error 任意本地 WWS 错误。
 * @returns 保留 code/retryable/fatal、丢弃内部文本和详情的错误对象。
 */
export function toSafePublicError(error: WwsError): WwsError {
  const details = error.details === undefined
    ? undefined
    : Object.freeze(Object.fromEntries(Object.entries(error.details).filter(([, value]) => value === null
      || typeof value === 'boolean'
      || typeof value === 'number'
      || typeof value === 'string')))
  const options = details === undefined
    ? { fatal: error.fatal, retryable: error.retryable }
    : { details, fatal: error.fatal, retryable: error.retryable }
  return createSafePublicError(error.code, options)
}

/**
 * 判断未知异常是否为 WWS 错误。
 *
 * @param value 捕获到的未知异常。
 * @returns 值为 `WwsError` 时返回 `true`。
 */
export function isWwsError(value: unknown): value is WwsError {
  return value instanceof WwsError
}

/**
 * 将任意异常归一化为 WWS 错误，保留本地 cause 但不负责跨端口传播。
 *
 * @param value 原始异常或任意 throw 值。
 * @param code 非 WWS 错误时采用的稳定错误码。
 * @param message 当前 realm 中的后备文本。
 * @param options 可重试、终态与本地诊断元数据。
 * @returns 可被本地状态机处理的 `WwsError`。
 */
export function toWwsError(
  value: unknown,
  code: WwsErrorCode,
  message: string,
  options: Omit<WwsErrorOptions, 'cause'> = {},
): WwsError {
  if (isWwsError(value))
    return value

  return new WwsError(code, message, { ...options, cause: value })
}

/**
 * 创建参数校验错误。
 *
 * @param message 描述无效值的本地文本。
 * @param field 可选的字段路径，仅用于本地诊断。
 * @returns 错误码固定为 `INVALID_OPTIONS` 的错误。
 */
export function invalidOptions(message: string, field?: string): WwsError {
  return new WwsError('INVALID_OPTIONS', message, field === undefined ? {} : { details: { field } })
}
