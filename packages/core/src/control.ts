import type { ConnectionDiagnostics, ConnectionSnapshot, NormalizedRestoreOptions, RevisionReceipt, SendOptions, SendReceipt, SocketData } from './types'
import type { SharedConnectionConfig } from './config'
import type { WwsErrorCode } from './errors'

export interface ControlError {
  readonly code: WwsErrorCode
  readonly message: string
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
    | { readonly type: 'message', readonly data: unknown, readonly receivedAt: number, readonly replayed: boolean }
    | { readonly type: 'close', readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }
    | { readonly type: 'error', readonly error: ControlError }
    | { readonly type: 'overflow', readonly direction: 'inbound' | 'replay', readonly droppedMessages: number, readonly droppedBytes: number }

export function isClientControlMessage(value: unknown): value is ClientControlMessage {
  if (value === null || typeof value !== 'object')
    return false
  const record = value as Record<string, unknown>
  if (typeof record.type !== 'string')
    return false
  if (record.type === 'lease' || record.type === 'suspend' || record.type === 'restore')
    return true
  if (typeof record.requestId !== 'string' || record.requestId.length === 0)
    return false
  if (record.type === 'hello') {
    return typeof record.protocolMajor === 'number'
      && typeof record.clientId === 'string'
      && typeof record.id === 'string'
      && typeof record.url === 'string'
      && typeof record.configCanonical === 'string'
      && typeof record.configFingerprint === 'string'
      && record.shared !== null
      && typeof record.shared === 'object'
      && record.restore !== null
      && typeof record.restore === 'object'
  }
  return ['open', 'close', 'send', 'update-auth', 'clear-auth', 'update-url', 'reconnect', 'diagnostics', 'dispose'].includes(record.type)
}

export function isWorkerControlMessage(value: unknown): value is WorkerControlMessage {
  if (value === null || typeof value !== 'object')
    return false
  const record = value as Record<string, unknown>
  return typeof record.type === 'string'
    && ['response', 'state', 'open', 'message', 'close', 'error', 'overflow'].includes(record.type)
}

export type { SocketData }
