/** 在连接层调度 adapter 定义的应用心跳，并将超时转换为连接失败。 */
import type { HeartbeatOptions, TimerHandle } from '../shared/types'

export interface HeartbeatRuntime {
  /** 发送一次已编码的心跳帧；失败由连接控制器处理。 */
  readonly send: () => void | Promise<void>
  /** 心跳超时时调用的连接级处理器。 */
  readonly onTimeout: () => void
  /** 可注入的当前时间源。 */
  readonly now?: () => number
  /** Worker/page 可注入的定时器工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 与 `setTimeout` 配对的清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
}

export class HeartbeatController {
  /** 当前心跳周期 timer。 */
  private intervalHandle: TimerHandle | undefined
  /** 当前等待 pong 的超时 timer。 */
  private timeoutHandle: TimerHandle | undefined
  /** 是否已启动，防止停止后的异步 tick 继续发送。 */
  private running = false
  /** 配置超时时是否正在等待 pong 或入站活动。 */
  private awaiting = false

  /** 创建未启动的心跳控制器。 */
  constructor(readonly options: Readonly<HeartbeatOptions>, private readonly runtime: HeartbeatRuntime) {}

  /** 开始心跳周期；重复调用先清理旧 timer。 */
  start(): void {
    this.stop()
    this.running = true
    this.schedule()
  }

  /** 停止并清理周期与超时 timer。 */
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

  /** 记录 pong 或任意活动，解除当前超时等待。 */
  acknowledge(kind: 'pong' | 'activity' = 'pong'): void {
    if (!this.running || (this.options.mode === 'pong' && kind !== 'pong'))
      return
    this.awaiting = false
    if (this.timeoutHandle !== undefined)
      (this.runtime.clearTimeout ?? globalThis.clearTimeout)(this.timeoutHandle)
    this.timeoutHandle = undefined
  }

  /** 暴露当前是否等待 pong。 */
  get waitingForResponse(): boolean {
    return this.awaiting
  }

  /** 安排下一次心跳发送。 */
  private schedule(): void {
    if (!this.running)
      return
    this.intervalHandle = (this.runtime.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => {
      void this.tick()
    }, this.options.interval)
  }

  /** 发送心跳并在需要时安装 pong 超时。 */
  private async tick(): Promise<void> {
    if (!this.running)
      return
    if (this.awaiting) {
      this.schedule()
      return
    }
    this.awaiting = this.options.pongTimeout !== undefined
    try {
      await this.runtime.send()
    }
    catch {
      // socket/controller 统一拥有发送失败与重连决策；这里仅维护存活超时，
      // 不能因单次发送异常改变连接状态机的不变量。
    }
    if (this.awaiting && this.running && this.options.pongTimeout !== undefined) {
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
