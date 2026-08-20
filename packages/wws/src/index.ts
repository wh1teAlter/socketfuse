import type { CreateWebSocketOptions, SharedWorkerLike, SocketData, WebSocketClient } from '@wws/core'
import {
  DirectTransport,
  normalizeWebSocketOptions,
  PageWebSocketClient,
  SharedWorkerTransport,
  WwsError,
} from '@wws/core'
import { INLINE_WORKER_SOURCE } from './inline-worker-source.generated'

export { isWwsError, WWS_ERROR_CODES, WwsError } from '@wws/core'
export type {
  BackpressureOptions,
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  CreateWebSocketOptions,
  HeartbeatOptions,
  JsonAuthTemplate,
  JsonHeartbeatTemplate,
  JsonMatcher,
  JsonProtocolOptions,
  JsonValue,
  LeaseOptions,
  LifecycleOptions,
  ProtocolCapabilities,
  QueueOptions,
  ReadyState,
  ReconnectOptions,
  ResourceLimits,
  RestoreOptions,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  SocketData,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
  WwsCloseEvent,
  WwsDiagnosticEvent,
  WwsErrorCode,
  WwsLogger,
  WwsMessageEvent,
  WwsOverflowEvent,
  WwsStateChangeEvent,
} from '@wws/core'

export function createWebSocket<Incoming = SocketData, Outgoing = SocketData, Auth = unknown>(
  url: string | URL,
  options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
): WebSocketClient<Incoming, Outgoing, Auth> {
  const config = normalizeWebSocketOptions(url, options)
  const clientId = createClientId()
  const fallback = createDirectFallback(config, clientId)
  let transport: DirectTransport<Incoming, Outgoing, Auth> | SharedWorkerTransport<Incoming, Outgoing, Auth>

  if (typeof SharedWorker === 'undefined') {
    if (config.local.fallback === 'error')
      throw new WwsError('WORKER_UNSUPPORTED', 'SharedWorker is not available in this environment')
    if (fallback === undefined)
      throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'Neither SharedWorker nor WebSocket is available')
    transport = fallback
  }
  else {
    try {
      const worker = options.worker === undefined
        ? new SharedWorker(createInlineWorkerUrl())
        : options.worker()
      transport = new SharedWorkerTransport({
        clientId,
        config,
        ...(config.local.fallback === 'direct' && fallback !== undefined ? { fallback } : {}),
        mode: config.local.workerMode,
        worker: worker as unknown as SharedWorkerLike,
      })
    }
    catch (cause) {
      if (config.local.fallback === 'error')
        throw new WwsError('WORKER_CONSTRUCTION_FAILED', 'Unable to construct SharedWorker', { cause })
      if (fallback === undefined)
        throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback', { cause })
      transport = fallback
    }
  }

  const client = new PageWebSocketClient(config, transport, options, clientId)
  if (config.local.immediate)
    void client.open().catch(() => undefined)
  return client
}

function createDirectFallback<Incoming, Outgoing, Auth>(
  config: ReturnType<typeof normalizeWebSocketOptions<Incoming, Outgoing, Auth>>,
  clientId: string,
): DirectTransport<Incoming, Outgoing, Auth> | undefined {
  if (typeof WebSocket === 'undefined')
    return undefined
  return new DirectTransport({ clientId, config })
}

function createInlineWorkerUrl(): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(INLINE_WORKER_SOURCE)}`
}

function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
