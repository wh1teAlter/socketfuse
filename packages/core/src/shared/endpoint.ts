/**
 * 共享的 endpoint 校验，供页面、connection 与 Worker 扩展提交 URL 时复用。
 *
 * 三个调用点的接受与拒绝规则必须完全一致，否则同一个 URL 会在不同提交路径得到
 * 不同结果；错误只暴露固定安全错误码，绝不携带完整 URL 或 query。
 */
import { MAX_ENDPOINT_LENGTH } from './constants'
import { SocketFuseError } from './errors'

/**
 * 只保留 endpoint 的 origin，用于诊断与交给业务扩展。
 *
 * @param url 当前 endpoint 绝对 URL。
 * @returns 仅含协议、host 与端口的 origin；无法解析时返回空字符串。
 */
export function safeEndpointOrigin(url: string): string {
  try {
    return new URL(url).origin
  }
  catch {
    return ''
  }
}

/**
 * 校验并规范化一个绝对 `ws:`/`wss:` endpoint。
 *
 * @param value 待校验的未知输入；非字符串一律拒绝。
 * @returns 规范化后的 href。
 * @throws `INVALID_OPTIONS`，当输入非字符串、非绝对 URL、非 ws/wss 协议，或规范化前后超出长度上限时。
 */
export function normalizeEndpointUrl(value: unknown): string {
  if (typeof value !== 'string')
    throw new SocketFuseError('INVALID_OPTIONS')
  if (value.length > MAX_ENDPOINT_LENGTH)
    throw new SocketFuseError('INVALID_OPTIONS')
  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    throw new SocketFuseError('INVALID_OPTIONS')
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
    throw new SocketFuseError('INVALID_OPTIONS')
  if (parsed.username !== '' || parsed.password !== '' || parsed.href.includes('#'))
    throw new SocketFuseError('INVALID_OPTIONS')
  if (parsed.href.length > MAX_ENDPOINT_LENGTH)
    throw new SocketFuseError('INVALID_OPTIONS')
  return parsed.href
}
