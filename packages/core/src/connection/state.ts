import type { ConnectionState, ReadyState, WebSocketStatus } from '../shared/types'
import { WwsError } from '../shared/errors'

const transitions: Readonly<Record<ConnectionState, readonly ConnectionState[]>> = {
  closed: ['connecting', 'idle', 'failed'],
  closing: ['closed', 'idle', 'connecting'],
  connecting: ['handshaking', 'open', 'reconnecting', 'closing', 'closed', 'failed'],
  failed: ['connecting', 'idle'],
  handshaking: ['open', 'reconnecting', 'closing', 'closed', 'failed'],
  idle: ['connecting', 'closed'],
  open: ['reconnecting', 'closing', 'closed', 'failed'],
  reconnecting: ['connecting', 'closing', 'closed', 'failed'],
}

export interface StateTransition {
  readonly previous: ConnectionState
  readonly state: ConnectionState
}

export class ConnectionStateMachine {
  private current: ConnectionState = 'idle'

  get state(): ConnectionState {
    return this.current
  }

  transition(next: ConnectionState): StateTransition {
    if (next === this.current)
      return { previous: this.current, state: next }
    if (!transitions[this.current].includes(next)) {
      throw new WwsError('INTERNAL_STATE_ERROR', `Invalid connection transition ${this.current} -> ${next}`, {
        fatal: true,
        details: { from: this.current, to: next },
      })
    }
    const previous = this.current
    this.current = next
    return { previous, state: next }
  }

  reset(): StateTransition {
    const previous = this.current
    this.current = 'idle'
    return { previous, state: 'idle' }
  }
}

export function readyStateFor(state: ConnectionState): ReadyState {
  if (state === 'connecting' || state === 'handshaking' || state === 'reconnecting')
    return 0
  if (state === 'open')
    return 1
  if (state === 'closing')
    return 2
  return 3
}

export function statusFor(state: ConnectionState): WebSocketStatus {
  if (state === 'connecting' || state === 'handshaking' || state === 'reconnecting')
    return 'CONNECTING'
  if (state === 'open')
    return 'OPEN'
  return 'CLOSED'
}
