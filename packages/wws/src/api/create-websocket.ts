import { type CreateWebSocketOptions, DirectTransport, type JsonProtocolOptions, type JsonValue,
  normalizeWebSocketOptions,
  PageWebSocketClient,
  type SharedWorkerLike,
  SharedWorkerTransport,
  type SocketData,
  type WebSocketClient,
  WwsError } from '@wws/core'
import { INLINE_WORKER_SOURCE } from '../worker/source.generated'

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

function createSharedTransport<Incoming, Outgoing, Auth>(
  config: ReturnType<typeof normalizeWebSocketOptions<Incoming, Outgoing, Auth>>,
  clientId: string,
  options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
  allowFallback = true,
): SharedWorkerTransport<Incoming, Outgoing, Auth> {
  const worker = options.worker === undefined
    ? new SharedWorker(createInlineWorkerUrl())
    : options.worker()
  const createFallback = (): DirectTransport<Incoming, Outgoing, Auth> => {
    const fallback = createDirectFallback(config, clientId)
    if (fallback === undefined)
      throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback')
    return fallback
  }
  return new SharedWorkerTransport({
    clientId,
    config,
    ...(allowFallback && config.local.fallback === 'direct' ? { createFallback } : {}),
    mode: config.local.workerMode,
    worker: worker as unknown as SharedWorkerLike,
  })
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
export function createWebSocket(
  url: string | URL,
  options: CreateWebSocketOptions<JsonValue, JsonValue, unknown> & { readonly protocol: JsonProtocolOptions },
): WebSocketClient<JsonValue, JsonValue, unknown>
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData, Auth = unknown>(
  url: string | URL,
  options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
): WebSocketClient<Incoming, Outgoing, Auth>
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData, Auth = unknown>(
  url: string | URL,
  options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
): WebSocketClient<Incoming, Outgoing, Auth> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WWS clients require a browser page environment')
  const config = normalizeWebSocketOptions(url, options)
  const clientId = createClientId()
  let transport: DirectTransport<Incoming, Outgoing, Auth> | SharedWorkerTransport<Incoming, Outgoing, Auth>

  const createFallback = (): DirectTransport<Incoming, Outgoing, Auth> => {
    const fallback = createDirectFallback(config, clientId)
    if (fallback === undefined)
      throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback')
    return fallback
  }

  if (typeof SharedWorker === 'undefined') {
    if (config.local.fallback === 'error')
      throw new WwsError('WORKER_UNSUPPORTED', 'SharedWorker is not available in this environment')
    transport = createFallback()
  }
  else {
    try {
      transport = createSharedTransport(config, clientId, options)
    }
    catch (cause) {
      if (config.local.fallback === 'error')
        throw new WwsError('WORKER_CONSTRUCTION_FAILED', 'Unable to construct SharedWorker', { cause })
      try {
        transport = createFallback()
      }
      catch (fallbackCause) {
        throw new WwsError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback', { cause: fallbackCause })
      }
    }
  }

  const recreateSharedTransport = transport.kind === 'shared-worker'
    ? () => createSharedTransport(config, clientId, options, false)
    : undefined
  const client = new PageWebSocketClient(config, transport, options, clientId, recreateSharedTransport)
  if (config.local.immediate)
    void client.open().catch(() => undefined)
  return client
}
