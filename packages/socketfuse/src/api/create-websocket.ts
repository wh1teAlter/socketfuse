/**
 * 页面 facade 的连接创建实现。
 *
 * 本模块负责同步校验页面环境、选择 SharedWorker/direct transport，并把 Worker
 * 初始化失败转换为配置允许的降级结果；网络故障不会触发 transport 偷换。
 */
import { type CreateWebSocketOptions, DirectTransport, type JsonProtocolOptions, type JsonValue,
  normalizeWebSocketOptions,
  PageWebSocketClient,
  type SharedWorkerLike,
  SharedWorkerTransport,
  type SocketData,
  SocketFuseError,
  type WebSocketClient } from '@socketfuse/core'
import { INLINE_WORKER_SOURCE } from '../worker/source.generated'

/** 在当前页面环境创建 direct transport，供明确允许的 Worker 初始化降级使用。 */
function createDirectFallback<Incoming, Outgoing>(
  config: ReturnType<typeof normalizeWebSocketOptions<Incoming, Outgoing>>,
  clientId: string,
): DirectTransport<Incoming, Outgoing> | undefined {
  if (typeof WebSocket === 'undefined')
    return undefined
  return new DirectTransport({ clientId, config })
}

/** 将内联 Worker 源码转换为稳定的 data URL。 */
function createInlineWorkerUrl(): string {
  return `data:text/javascript;charset=utf-8,${encodeURIComponent(INLINE_WORKER_SOURCE)}`
}

/** 创建 SharedWorker transport，并保留只在初始化失败时使用的 fallback 工厂。 */
function createSharedTransport<Incoming, Outgoing>(
  config: ReturnType<typeof normalizeWebSocketOptions<Incoming, Outgoing>>,
  clientId: string,
  options: CreateWebSocketOptions<Incoming, Outgoing>,
  allowFallback = true,
): SharedWorkerTransport<Incoming, Outgoing> {
  const worker = options.worker === undefined
    ? new SharedWorker(createInlineWorkerUrl())
    : options.worker()
  const createFallback = (): DirectTransport<Incoming, Outgoing> => {
    const fallback = createDirectFallback(config, clientId)
    if (fallback === undefined)
      throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback')
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

/** 生成只在当前页面实例内使用的 client id。 */
function createClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * 创建由同源 SharedWorker 连接驱动的页面本地客户端。
 *
 * 函数同步返回。`immediate: true`（默认值）时会在后台开始打开；需要可等待的
 * 连接快照时调用 `open()`。Worker 建立失败遵循配置的 direct/error 降级策略，
 * socket 和协议错误则始终留在已选 transport 中处理。
 *
 * @typeParam Incoming 由 `onMessage` 接收的已解码业务 payload。
 * @typeParam Outgoing `sendMessage` 可接受的应用值。
 * @param url 初始的绝对 `ws:` 或 `wss:` endpoint，最长 16384 字符。
 * @param options 共享连接与页面本地行为。
 * @returns 稳定的页面本地客户端；`immediate` 为 true 时首次打开会在后台进行。
 * @throws 在非浏览器页面 realm、选项无效、`fallback` 为 `error` 且 Worker 不可用，
 * 或 direct WebSocket 降级不可用时，同步抛出 `SocketFuseError`。
 */
export function createWebSocket(
  url: string,
  options: CreateWebSocketOptions<JsonValue, JsonValue> & { readonly protocol: JsonProtocolOptions },
): WebSocketClient<JsonValue, JsonValue>
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData>(
  url: string,
  options: CreateWebSocketOptions<Incoming, Outgoing>,
): WebSocketClient<Incoming, Outgoing>
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData>(
  url: string,
  options: CreateWebSocketOptions<Incoming, Outgoing>,
): WebSocketClient<Incoming, Outgoing> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED', 'SocketFuse clients require a browser page environment')
  const config = normalizeWebSocketOptions(url, options)
  const clientId = createClientId()
  let transport: DirectTransport<Incoming, Outgoing> | SharedWorkerTransport<Incoming, Outgoing>

  const createFallback = (): DirectTransport<Incoming, Outgoing> => {
    const fallback = createDirectFallback(config, clientId)
    if (fallback === undefined)
      throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback')
    return fallback
  }

  if (typeof SharedWorker === 'undefined') {
    if (config.local.fallback === 'error')
      throw new SocketFuseError('WORKER_UNSUPPORTED', 'SharedWorker is not available in this environment')
    transport = createFallback()
  }
  else {
    try {
      transport = createSharedTransport(config, clientId, options)
    }
    catch (cause) {
      if (config.local.fallback === 'error')
        throw new SocketFuseError('WORKER_CONSTRUCTION_FAILED', 'Unable to construct SharedWorker', { cause })
      try {
        transport = createFallback()
      }
      catch (fallbackCause) {
        throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available for direct fallback', { cause: fallbackCause })
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
