/**
 * SocketFuse 的稳定错误模型与跨 Worker 脱敏边界。
 *
 * 页面只能依据错误码与安全文本做控制流；adapter、服务端和浏览器原始异常不能跨端口
 * 传播，以免凭据、URL 或内部实现细节进入其他页面或日志。
 */
/** SocketFuse v1 对外稳定的机器可读错误码集合。 */
export const SOCKET_FUSE_ERROR_CODES = [
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
  'STALE_RECONNECT_PLAN',
  'SEND_WHILE_DISCONNECTED',
  'QUEUE_FULL',
  'QUEUE_BYTES_EXCEEDED',
  'BACKPRESSURE',
  'MESSAGE_TOO_LARGE',
  'RESOURCE_LIMIT_EXCEEDED',
  'ENCODE_FAILED',
  'DECODE_FAILED',
  'PROTOCOL_ERROR',
  'PROTOCOL_CONTRACT_VIOLATION',
  'RECONNECT_IN_PROGRESS',
  'PREPARATION_BUSY',
  'SEND_OUTCOME_UNKNOWN',
  'INBOUND_OVERFLOW',
  'INTERNAL_STATE_ERROR',
] as const

/** 所有 SocketFuse 稳定错误码构成的联合类型。 */
export type SocketFuseErrorCode = typeof SOCKET_FUSE_ERROR_CODES[number]

/** 用于 O(1) 校验外部控制消息错误码的只读集合。 */
const socketFuseErrorCodeSet: ReadonlySet<string> = new Set(SOCKET_FUSE_ERROR_CODES)

/**
 * 判断未知值是否为 SocketFuse 可公开的稳定错误码。
 *
 * @param value 可能来自 Worker 控制消息的未知值。
 * @returns 是稳定错误码时返回 `true`。
 */
export function isSocketFuseErrorCode(value: unknown): value is SocketFuseErrorCode {
  return typeof value === 'string' && socketFuseErrorCodeSet.has(value)
}

/** 构造安全错误时唯一允许的状态标记。 */
export interface SocketFuseErrorOptions {
  /** 当前失败是否可能通过重试恢复。 */
  retryable?: boolean
  /** 当前失败是否令逻辑 client 进入终态。 */
  fatal?: boolean
}

/** 跨端口时唯一允许使用的稳定英文错误文本映射。 */
const SAFE_ERROR_MESSAGES: Readonly<Record<SocketFuseErrorCode, string>> = Object.freeze({
  ABORTED: 'Operation was aborted',
  ADAPTER_NOT_REGISTERED: 'The requested protocol adapter is unavailable in this Worker',
  BACKPRESSURE: 'Socket backpressure limit was reached',
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
  INVALID_OPTIONS: 'Invalid SocketFuse options',
  MESSAGE_TOO_LARGE: 'Message exceeds the configured size limit',
  PROTOCOL_ERROR: 'Protocol processing failed',
  PROTOCOL_CONTRACT_VIOLATION: 'A synchronous protocol hook returned an asynchronous result',
  RECONNECT_IN_PROGRESS: 'A reconnect with a different counting policy is already in progress',
  PREPARATION_BUSY: 'Attempt preparation capacity is exhausted',
  SEND_OUTCOME_UNKNOWN: 'The local send acceptance outcome is unknown',
  PROTOCOL_VERSION_MISMATCH: 'SharedWorker control protocol version mismatch',
  QUEUE_BYTES_EXCEEDED: 'Outbound queue byte limit was reached',
  QUEUE_FULL: 'Outbound queue message limit was reached',
  RESOURCE_LIMIT_EXCEEDED: 'Resource limit was reached',
  RETRY_EXHAUSTED: 'Reconnect retry budget was exhausted',
  SEND_WHILE_DISCONNECTED: 'Cannot send while the connection is disconnected',
  SOCKET_ERROR: 'WebSocket error',
  STALE_RECONNECT_PLAN: 'Reconnect plan is stale',
  WORKER_CONSTRUCTION_FAILED: 'Unable to construct SharedWorker',
  WORKER_DISCONNECTED: 'SharedWorker is disconnected',
  WORKER_INIT_TIMEOUT: 'SharedWorker initialization timed out',
  WORKER_LOAD_FAILED: 'SharedWorker failed to load',
  WORKER_UNSUPPORTED: 'SharedWorker is unavailable in this environment',
})

/**
 * 返回错误码对应的稳定安全文本。
 *
 * @param code 已校验的 SocketFuse 错误码。
 * @returns 不含 adapter、服务端或浏览器原始文本的错误说明。
 */
export function safeErrorMessage(code: SocketFuseErrorCode): string {
  return SAFE_ERROR_MESSAGES[code]
}

/**
 * 异步操作 reject 与 error callback 使用的错误契约。
 *
 * 调用方必须依据 `code` 而不是匹配 `message`。文本完全由库生成，错误对象不保存
 * 应用异常、凭据、payload 或自由形式诊断字段；创建和跨端口行为一致。
 */
export class SocketFuseError extends Error {
  /** 便于跨 realm 判断的稳定错误名称。 */
  readonly name = 'SocketFuseError' as const
  /** 面向调用方的稳定错误码。 */
  readonly code: SocketFuseErrorCode
  /** 是否允许当前操作自动或手动重试。 */
  readonly retryable: boolean
  /** 是否表示 client 不应再尝试恢复。 */
  readonly fatal: boolean

  /**
   * 创建本地错误对象。
   *
   * @param code 供调用方分支处理的稳定错误码。
   * @param options 重试与终态标记；不接受附加异常文本。
   */
  constructor(code: SocketFuseErrorCode, options: SocketFuseErrorOptions = {}) {
    super(safeErrorMessage(isSocketFuseErrorCode(code) ? code : 'INTERNAL_STATE_ERROR'))
    this.code = isSocketFuseErrorCode(code) ? code : 'INTERNAL_STATE_ERROR'
    this.retryable = options.retryable ?? false
    this.fatal = options.fatal ?? false
  }
}

/**
 * 从已验证的控制平面字段构造页面安全错误。
 *
 * @param code Worker 发送的稳定错误码。
 * @param options Worker 声明的重试与终态标记。
 * @returns 不携带原始 cause 的页面安全错误对象。
 */
export function createSafePublicError(
  code: SocketFuseErrorCode,
  options: SocketFuseErrorOptions = {},
): SocketFuseError {
  return new SocketFuseError(code, options)
}

/**
 * 将本地错误裁剪为可跨端口的安全形式。
 *
 * @param error 任意本地 SocketFuse 错误。
 * @returns 保留 code/retryable/fatal、丢弃内部文本和详情的错误对象。
 */
export function toSafePublicError(error: SocketFuseError): SocketFuseError {
  return createSafePublicError(error.code, { fatal: error.fatal, retryable: error.retryable })
}

/**
 * 判断未知异常是否为 SocketFuse 错误。
 *
 * @param value 捕获到的未知异常。
 * @returns 值为 `SocketFuseError` 时返回 `true`。
 */
export function isSocketFuseError(value: unknown): value is SocketFuseError {
  return value instanceof SocketFuseError
}

/**
 * 将应用异常按失败阶段映射，绝不信任应用伪造的 SocketFuseError。
 *
 * @param value 原始异常或任意 throw 值。
 * @param code 非 SocketFuse 错误时采用的稳定错误码。
 * @param options 可重试与终态标记。
 * @returns 可被本地状态机处理的 `SocketFuseError`。
 */
export function toSocketFuseError(
  _value: unknown,
  code: SocketFuseErrorCode,
  options: SocketFuseErrorOptions = {},
): SocketFuseError {
  return new SocketFuseError(code, options)
}

/**
 * 创建参数校验错误。
 *
 * @returns 错误码固定为 `INVALID_OPTIONS` 的错误。
 */
export function invalidOptions(): SocketFuseError {
  return new SocketFuseError('INVALID_OPTIONS')
}
