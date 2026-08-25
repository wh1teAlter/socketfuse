/** 计算指数退避和抖动，并维护一次物理连接的重试预算。 */
import type { ReconnectOptions } from '../shared/types'

export interface RetryDecision {
  /** 是否允许本次重试。 */
  readonly allowed: boolean
  /** 本次等待时长，单位为毫秒。 */
  readonly delay: number
  /** 参与退避计算的尝试序号。 */
  readonly attempt: number
}

/** 按指数退避、上限和抖动计算一次重连等待时间。 */
export function calculateReconnectDelay(options: Readonly<ReconnectOptions>, attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt <= 0)
    return 0
  const base = Math.min(options.maxDelay, options.initialDelay * options.factor ** (attempt - 1))
  const sample = Math.min(1, Math.max(0, random()))
  return base * (1 - options.jitter + (2 * options.jitter * sample))
}

export class ReconnectPolicy {
  /** 当前连续物理连接尝试次数。 */
  private attemptValue = 0
  /** 最近一次成功打开的时间，单位为 Unix 毫秒。 */
  private openedAt: number | null = null

  /** 创建带可注入随机源的重连策略。 */
  constructor(readonly options: Readonly<ReconnectOptions>, private readonly random: () => number = Math.random) {}

  /** 返回当前尝试次数。 */
  get attempt(): number {
    return this.attemptValue
  }

  /** 记录一次物理连接尝试并返回尝试序号。 */
  recordAttempt(): number {
    this.attemptValue++
    return this.attemptValue
  }

  /** 记录连接打开时间，供 stableThreshold 判断。 */
  recordOpen(now: number): void {
    this.openedAt = now
  }

  /** 连接稳定达到阈值时重置失败次数。 */
  maybeReset(now: number): boolean {
    if (this.openedAt !== null && now - this.openedAt >= this.options.stableThreshold) {
      this.attemptValue = 0
      this.openedAt = null
      return true
    }
    return false
  }

  /** 根据预算和 retryable 标志决定是否重连。 */
  decide(now: number, retryable = true): RetryDecision {
    this.maybeReset(now)
    if (!retryable || this.attemptValue - 1 >= this.options.retries)
      return { allowed: false, attempt: this.attemptValue, delay: 0 }
    const attempt = this.attemptValue + 1
    return { allowed: true, attempt, delay: calculateReconnectDelay(this.options, attempt, this.random) }
  }

  /** 显式清除失败计数和已打开时间。 */
  reset(): void {
    this.attemptValue = 0
    this.openedAt = null
  }
}
