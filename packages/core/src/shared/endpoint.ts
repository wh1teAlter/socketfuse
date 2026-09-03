/**
 * 共享的 endpoint 校验，供页面、connection 与 Worker 扩展提交 URL 时复用。
 *
 * 三个调用点的接受与拒绝规则必须完全一致，否则同一个 URL 会在不同提交路径得到
 * 不同结果；错误只暴露调用点标签，绝不携带完整 URL 或 query。
 */
import { invalidOptions, SocketFuseError } from './errors'
import { MAX_ENDPOINT_LENGTH } from './constants'

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
 * @param label 错误文本使用的调用点标签，例如 `url` 或 `Reconnect url`。
 * @param field 需要在 details 中暴露字段路径时传入；省略则不带 details。
 * @returns 规范化后的 href。
 * @throws `INVALID_OPTIONS`，当输入非字符串、非绝对 URL、非 ws/wss 协议，或规范化前后超出长度上限时。
 */
export function normalizeEndpointUrl(value: unknown, label: string, field?: string): string {
  const fail = (message: string): SocketFuseError =>
    field === undefined ? new SocketFuseError('INVALID_OPTIONS', message) : invalidOptions(message, field)
  if (typeof value !== 'string')
    throw fail(`${label} must be a fixed string`)
  if (value.length > MAX_ENDPOINT_LENGTH)
    throw fail(`${label} must be at most ${MAX_ENDPOINT_LENGTH} characters`)
  let parsed: URL
  try {
    parsed = new URL(value)
  }
  catch {
    throw fail(`${label} must be an absolute ws: or wss: URL`)
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
    throw fail(`${label} must use ws: or wss:`)
  if (parsed.href.length > MAX_ENDPOINT_LENGTH)
    throw fail(`${label} must be at most ${MAX_ENDPOINT_LENGTH} characters after normalization`)
  return parsed.href
}
