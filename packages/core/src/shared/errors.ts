/** Stable machine-readable error codes emitted by WWS v1. */
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

/** Union of every stable WWS v1 error code. */
export type WwsErrorCode = typeof WWS_ERROR_CODES[number]

const wwsErrorCodeSet: ReadonlySet<string> = new Set(WWS_ERROR_CODES)

/** Return whether a value is one of WWS's stable public error codes. */
export function isWwsErrorCode(value: unknown): value is WwsErrorCode {
  return typeof value === 'string' && wwsErrorCodeSet.has(value)
}

export interface WwsErrorOptions {
  retryable?: boolean
  fatal?: boolean
  details?: Readonly<Record<string, unknown>>
  cause?: unknown
}

/**
 * Error contract used by rejected operations and error callbacks.
 *
 * Prefer `code` over matching `message`. Details are sanitized before errors
 * cross the Worker boundary or reach page callbacks.
 */
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

/** Return the stable WWS-owned public text for an error code. */
export function safeErrorMessage(code: WwsErrorCode): string {
  return SAFE_ERROR_MESSAGES[code]
}

/** Construct a page-safe error from sanitized control-plane fields. */
export function createSafePublicError(
  code: WwsErrorCode,
  options: Pick<WwsErrorOptions, 'details' | 'fatal' | 'retryable'> = {},
): WwsError {
  return new WwsError(code, safeErrorMessage(code), options)
}

/** Return a stable page-safe error without retaining adapter/server error text. */
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

/** Return whether an unknown value is a `WwsError`. */
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
