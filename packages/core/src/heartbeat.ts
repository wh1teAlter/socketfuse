import type { HeartbeatOptions, TimerHandle } from './types'

export interface HeartbeatRuntime {
  readonly send: () => void | Promise<void>
  readonly onTimeout: () => void
  readonly now?: () => number
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  readonly clearTimeout?: (handle: TimerHandle) => void
}

export class HeartbeatController {
  private intervalHandle: TimerHandle | undefined
  private timeoutHandle: TimerHandle | undefined
  private running = false
  private awaiting = false

  constructor(readonly options: Readonly<HeartbeatOptions>, private readonly runtime: HeartbeatRuntime) {}

  start(): void {
    this.stop()
    this.running = true
    this.schedule()
  }

  stop(): void {
    this.running = false
    this.awaiting = false
    if (this.intervalHandle !== undefined)
      (this.runtime.clearTimeout ?? globalThis.clearTimeout)(this.intervalHandle)
    if (this.timeoutHandle !== undefined)
      (this.runtime.clearTimeout ?? globalThis.clearTimeout)(this.timeoutHandle)
    this.intervalHandle = undefined
    this.timeoutHandle = undefined
  }

  acknowledge(kind: 'pong' | 'activity' = 'pong'): void {
    if (!this.running || (this.options.mode === 'pong' && kind !== 'pong'))
      return
    this.awaiting = false
    if (this.timeoutHandle !== undefined)
      (this.runtime.clearTimeout ?? globalThis.clearTimeout)(this.timeoutHandle)
    this.timeoutHandle = undefined
  }

  get waitingForResponse(): boolean {
    return this.awaiting
  }

  private schedule(): void {
    if (!this.running)
      return
    this.intervalHandle = (this.runtime.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => {
      void this.tick()
    }, this.options.interval)
  }

  private async tick(): Promise<void> {
    if (!this.running)
      return
    this.awaiting = this.options.mode === 'pong'
    try {
      await this.runtime.send()
    }
    catch {
      // Socket/controller owns send failures; heartbeat only owns liveness timeout.
    }
    if (this.awaiting && this.running) {
      this.timeoutHandle = (this.runtime.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => {
        if (this.running && this.awaiting) {
          this.awaiting = false
          this.runtime.onTimeout()
        }
      }, this.options.pongTimeout)
    }
    this.schedule()
  }
}
