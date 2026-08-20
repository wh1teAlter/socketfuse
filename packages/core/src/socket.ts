import type { SocketData } from './types'

export const SOCKET_CONNECTING = 0 as const
export const SOCKET_OPEN = 1 as const
export const SOCKET_CLOSING = 2 as const
export const SOCKET_CLOSED = 3 as const

export interface WebSocketLike {
  binaryType: 'arraybuffer' | 'blob'
  readonly bufferedAmount: number
  readonly readyState: number
  readonly protocol?: string
  send: (data: SocketData) => void
  close: (code?: number, reason?: string) => void
  addEventListener?: (type: string, listener: (event: unknown) => void) => void
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void
  onopen?: ((event: unknown) => void) | null | undefined
  onmessage?: ((event: { readonly data: SocketData }) => void) | null | undefined
  onerror?: ((event: unknown) => void) | null | undefined
  onclose?: ((event: { readonly code: number, readonly wasClean: boolean, readonly reason?: string }) => void) | null | undefined
}

export type WebSocketFactory = (url: string, protocols: readonly string[], binaryType: 'arraybuffer' | 'blob') => WebSocketLike

export function browserWebSocketFactory(url: string, protocols: readonly string[], binaryType: 'arraybuffer' | 'blob'): WebSocketLike {
  if (typeof WebSocket === 'undefined')
    throw new Error('WebSocket is not available')
  const socket = protocols.length === 0 ? new WebSocket(url) : new WebSocket(url, [...protocols])
  socket.binaryType = binaryType
  return socket as unknown as WebSocketLike
}

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
