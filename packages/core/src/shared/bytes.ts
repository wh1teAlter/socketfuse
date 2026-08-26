/**
 * 原生 WebSocket payload 的字节计算与大小限制。
 *
 * 所有队列与消息大小限制都使用这里的字节口径，避免 Blob、ArrayBufferView 与字符串
 * 在不同调用路径被按不同单位计算而突破共享连接边界。
 */
import type { SocketData } from './types'
import { invalidOptions, SocketFuseError } from './errors'

/**
 * 计算一条原生 WebSocket payload 的传输字节数。
 *
 * @param data 已由协议适配器编码的原生 payload。
 * @returns UTF-8 字符串或二进制缓冲区的字节数。
 */
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

/**
 * 断言编码后的 payload 未超过共享连接允许的字节上限。
 *
 * @param data 已编码的原生 WebSocket payload。
 * @param maxBytes 连接配置规定的最大字节数。
 * @returns 已计算的 payload 字节数，便于调用方避免重复计算。
 * @throws `MESSAGE_TOO_LARGE`，当 payload 超过上限时。
 */
export function assertEncodedMessageSize(data: SocketData, maxBytes: number): number {
  const bytes = socketDataByteLength(data)
  if (bytes > maxBytes)
    throw new SocketFuseError('MESSAGE_TOO_LARGE', 'Encoded message exceeds the configured limit', { details: { maxBytes, bytes } })
  return bytes
}
