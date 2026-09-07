/** 页面 facade 只校验配置和 realm，惰性构造一次性 transport 选择器与稳定 client。 */
import { createTransportSelector, type CreateWebSocketOptions, type JsonProtocolOptions, type JsonValue,
  normalizeWebSocketOptions, PageWebSocketClient, type SharedWorkerLike, type SocketData, SocketFuseError, type WebSocketClient } from '@socketfuse/core'
import { INLINE_WORKER_SOURCE } from '../worker/source.generated'

/** 把内联 Worker 源转换为稳定 data URL，只在真正 open 时调用。 */
function createInlineWorker(): SharedWorkerLike {
  if (typeof SharedWorker === 'undefined')
    throw new SocketFuseError('WORKER_UNSUPPORTED')
  return new SharedWorker('data:text/javascript;charset=utf-8,' + encodeURIComponent(INLINE_WORKER_SOURCE))
}

/**
 * 在浏览器页面创建稳定 client；默认 immediate 在后台开始参与。
 * @typeParam Incoming 页面最终接收的业务投影类型。
 * @typeParam Outgoing sendMessage 接受的应用值。
 * @param url 初始绝对 ws/wss URL，不得含 userinfo 或 fragment；完整 URL 不参与共享身份。
 * @param options 共享连接配置与页面本地 handler；custom 只传静态协议描述符。
 * @returns 稳定 client；open Promise 只等待当前尝试结果，发送成功只表示本地接纳。
 * @throws INVALID_OPTIONS 或 ENVIRONMENT_UNSUPPORTED；Worker 初始化错误通过 open rejection/error 事件报告。
 */
export function createWebSocket(url: string, options: CreateWebSocketOptions<JsonValue, JsonValue> & { readonly protocol: JsonProtocolOptions }): WebSocketClient<JsonValue, JsonValue>
/** 创建使用指定页面投影与出站类型的 client；参数、阶段与失败契约同上。 */
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData>(url: string, options: CreateWebSocketOptions<Incoming, Outgoing>): WebSocketClient<Incoming, Outgoing>
/** 校验页面 realm 与配置后建立惰性 client，不在同步创建阶段保留共享连接。 */
export function createWebSocket<Incoming = SocketData, Outgoing = SocketData>(url: string, options: CreateWebSocketOptions<Incoming, Outgoing>): WebSocketClient<Incoming, Outgoing> {
  if (typeof window === 'undefined' || typeof document === 'undefined')
    throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED')
  // 同步校验后的共享与页面本地配置。
  const config = normalizeWebSocketOptions(url, options)
  // 延迟到 open 才调用的 Worker 工厂。
  const worker = options.worker === undefined ? createInlineWorker : () => options.worker?.() as SharedWorkerLike
  // 固定当前 client 接入选择的状态容器。
  const selector = createTransportSelector(worker, config.local.workerMode, config.local.fallback)
  // 只拥有本地意图的稳定页面实例。
  const client = new PageWebSocketClient(config, options, selector)
  if (config.local.immediate)
    void client.open().catch(() => undefined)
  return client
}
