/** 定义可注入测试的最小 WebSocket 面和浏览器默认工厂。 */
import type { SocketData } from '../shared/types'

/** 与浏览器 WebSocket readyState 对齐的常量，供 controller 避免散落魔数。 */
export const SOCKET_CONNECTING = 0 as const
/** socket 已 open 的 readyState。 */
export const SOCKET_OPEN = 1 as const
/** socket 正在 closing 的 readyState。 */
export const SOCKET_CLOSING = 2 as const
/** socket 已 closed 的 readyState。 */
export const SOCKET_CLOSED = 3 as const

/** 连接控制器所需的原生 socket 能力，不包含页面或 Worker 对象。 */
export interface WebSocketLike {
  /** 浏览器接收二进制时的表示方式。 */
  binaryType: 'arraybuffer' | 'blob'
  /** 尚未发送到网络的 payload 字节数。 */
  readonly bufferedAmount: number
  /** 当前原生 readyState 数值。 */
  readonly readyState: number
  /** 已协商的 subprotocol；测试实现可省略。 */
  readonly protocol?: string
  /** 发送已编码 payload。 */
  send: (data: SocketData) => void
  /** 发起关闭。 */
  close: (code?: number, reason?: string) => void
  /** 绑定原生事件监听器。 */
  addEventListener?: (type: string, listener: (event: unknown) => void) => void
  /** 移除原生事件监听器。 */
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void
  /** addEventListener 不可用时的 open 回调。 */
  onopen?: ((event: unknown) => void) | null | undefined
  /** addEventListener 不可用时的 message 回调。 */
  onmessage?: ((event: { readonly data: SocketData }) => void) | null | undefined
  /** addEventListener 不可用时的 error 回调。 */
  onerror?: ((event: unknown) => void) | null | undefined
  /** addEventListener 不可用时的 close 回调。 */
  onclose?: ((event: { readonly code: number, readonly wasClean: boolean, readonly reason?: string }) => void) | null | undefined
}

/** 创建 WebSocketLike 的工厂类型，便于测试注入。 */
export type WebSocketFactory = (url: string, protocols: readonly string[], binaryType: 'arraybuffer' | 'blob') => WebSocketLike

/** 在浏览器页面或 Worker realm 中构造原生 WebSocket。 */
export function browserWebSocketFactory(url: string, protocols: readonly string[], binaryType: 'arraybuffer' | 'blob'): WebSocketLike {
  if (typeof WebSocket === 'undefined')
    throw new Error('WebSocket is not available')
  const socket = protocols.length === 0 ? new WebSocket(url) : new WebSocket(url, [...protocols])
  socket.binaryType = binaryType
  return socket as unknown as WebSocketLike
}

/** 绑定一个 socket 监听器并返回可重复调用的清理函数。 */
export function addSocketListener<T>(socket: WebSocketLike, type: string, listener: (event: T) => void): () => void {
  if (socket.addEventListener !== undefined) {
    const callback = listener as (event: unknown) => void
    socket.addEventListener(type, callback)
    return () => socket.removeEventListener?.(type, callback)
  }
  const property = `on${type}` as 'onopen'
  const previous = socket[property]
  socket[property] = listener as never
  return () => {
    if (socket[property] === listener)
      socket[property] = previous
  }
}
