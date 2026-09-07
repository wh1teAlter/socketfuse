/** 将连接控制器的状态映射为原生 WebSocket 兼容表示。 */
import type { ConnectionState, ReadyState, WebSocketStatus } from '../shared/types'

/** 将详细状态映射到原生 WebSocket readyState 数值。 */
export function readyStateFor(state: ConnectionState): ReadyState {
  if (state === 'connecting' || state === 'reconnecting')
    return 0
  if (state === 'open')
    return 1
  if (state === 'closing')
    return 2
  return 3
}

/** 将详细状态压缩为公开的 OPEN/CONNECTING/CLOSED 状态。 */
export function statusFor(state: ConnectionState): WebSocketStatus {
  if (state === 'connecting' || state === 'reconnecting')
    return 'CONNECTING'
  if (state === 'open')
    return 'OPEN'
  return 'CLOSED'
}
