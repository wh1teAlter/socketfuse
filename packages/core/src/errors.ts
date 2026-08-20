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

export type WwsErrorCode = typeof WWS_ERROR_CODES[number]

export interface WwsErrorOptions {
  retryable?: boolean
  fatal?: boolean
  details?: Readonly<Record<string, unknown>>
  cause?: unknown
}

export class WwsError extends Error {
  readonly name = 'WwsError' as const
  readonly code: WwsErrorCode
  readonly retryable: boolean
  readonly fatal: boolean
  readonly details: Readonly<Record<string, unknown>> | undefined
  override readonly cause: unknown

  constructor(code: WwsErrorCode, message: string, options: WwsErrorOptions = {}) {
    super(message)
    this.code = code
    this.retryable = options.retryable ?? false
    this.fatal = options.fatal ?? false
    this.details = options.details
    this.cause = options.cause
  }
}

export function isWwsError(value: unknown): value is WwsError {
  return value instanceof WwsError
}

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

export function invalidOptions(message: string, field?: string): WwsError {
  return new WwsError('INVALID_OPTIONS', message, field === undefined ? {} : { details: { field } })
}
