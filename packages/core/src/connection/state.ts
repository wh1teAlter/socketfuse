/** 将连接状态迁移限制在合法图中，并映射为 WebSocket 兼容状态。 */
import type { ConnectionState, ReadyState, WebSocketStatus } from '../shared/types'
import { SocketFuseError } from '../shared/errors'

/** 连接状态机允许的有向迁移图；未列出的边必须失败。 */
const transitions: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  closed: ['connecting', 'reconnecting', 'idle', 'failed'],
  closing: ['closed', 'idle', 'connecting', 'reconnecting'],
  connecting: ['open', 'reconnecting', 'closing', 'closed', 'failed'],
  failed: ['connecting', 'reconnecting', 'idle'],
  idle: ['connecting', 'reconnecting', 'closed'],
  open: ['reconnecting', 'closing', 'closed', 'failed'],
  reconnecting: ['connecting', 'closing', 'closed', 'failed'],
}

export interface StateTransition {
  /** 迁移前生命周期状态。 */
  readonly previous: ConnectionState
  /** 迁移后生命周期状态。 */
  readonly state: ConnectionState
}

export class ConnectionStateMachine {
  /** 当前物理连接状态；所有迁移必须经过 transition。 */
  private current: ConnectionState = 'idle'

  /** 返回当前状态。 */
  get state(): ConnectionState {
    return this.current
  }

  /** 校验并应用一个合法状态迁移。 */
  transition(next: ConnectionState): StateTransition {
    if (next === this.current)
      return { previous: this.current, state: next }
    if (!transitions[this.current].includes(next)) {
      throw new SocketFuseError('INTERNAL_STATE_ERROR', `Invalid connection transition ${this.current} -> ${next}`, {
        fatal: true,
        details: { from: this.current, to: next },
      })
    }
    const previous = this.current
    this.current = next
    return { previous, state: next }
  }

  /** 回到 idle，供新一轮连接生命周期开始。 */
  reset(): StateTransition {
    const previous = this.current
    this.current = 'idle'
    return { previous, state: 'idle' }
  }
}

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
