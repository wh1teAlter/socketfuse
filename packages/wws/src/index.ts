import { type CreateWebSocketOptions, DirectTransport, normalizeWebSocketOptions, PageWebSocketClient,
  type SharedWorkerLike,
  SharedWorkerTransport,
  type SocketData,
  type WebSocketClient,
  WwsError } from '@wws/core'
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

/**
 * Create a page-local client backed by a same-origin SharedWorker connection.
 *
 * The function returns synchronously. With `immediate: true` (the default),
 * opening starts in the background; call `open()` when the caller needs an
 * awaitable connection snapshot. Worker setup failures use the configured
 * direct/error fallback, while socket and protocol failures remain on the
 * selected transport.
 *
 * @typeParam Incoming Decoded business payload delivered to `onMessage`.
 * @typeParam Outgoing Application value accepted by `sendMessage`.
 * @typeParam Auth Revisioned authentication value accepted by `updateAuth`.
 * @param url Initial absolute `ws:` or `wss:` endpoint.
 * @param options Shared connection and page-local behavior.
 */
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
