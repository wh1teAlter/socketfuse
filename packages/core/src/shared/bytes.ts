import type { SocketData } from './types'
import { invalidOptions, WwsError } from './errors'

export function socketDataByteLength(data: SocketData): number {
  if (typeof data === 'string')
    return new TextEncoder().encode(data).byteLength
  if (typeof Blob !== 'undefined' && data instanceof Blob)
    return data.size
  if (data instanceof ArrayBuffer)
    return data.byteLength
  if (ArrayBuffer.isView(data))
    return data.byteLength
  throw invalidOptions('Unsupported WebSocket message data')
}

export function assertEncodedMessageSize(data: SocketData, maxBytes: number): number {
  const bytes = socketDataByteLength(data)
  if (bytes > maxBytes)
    throw new WwsError('MESSAGE_TOO_LARGE', 'Encoded message exceeds the configured limit', { details: { maxBytes, bytes } })
  return bytes
}
