import type { ReconnectOptions } from './types'

export interface RetryDecision {
  readonly allowed: boolean
  readonly delay: number
  readonly attempt: number
}

export function calculateReconnectDelay(options: Readonly<ReconnectOptions>, attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt <= 0)
    return 0
  const base = Math.min(options.maxDelay, options.initialDelay * options.factor ** (attempt - 1))
  const sample = Math.min(1, Math.max(0, random()))
  return base * (1 - options.jitter + (2 * options.jitter * sample))
}

export class ReconnectPolicy {
  private attemptValue = 0
  private openedAt: number | null = null

  constructor(readonly options: Readonly<ReconnectOptions>, private readonly random: () => number = Math.random) {}

  get attempt(): number {
    return this.attemptValue
  }

  recordAttempt(): number {
    this.attemptValue++
    return this.attemptValue
  }

  recordOpen(now: number): void {
    this.openedAt = now
  }

  maybeReset(now: number): boolean {
    if (this.openedAt !== null && now - this.openedAt >= this.options.stableThreshold) {
      this.attemptValue = 0
      this.openedAt = null
      return true
    }
    return false
  }

  decide(now: number, retryable = true): RetryDecision {
    this.maybeReset(now)
    if (!retryable || this.attemptValue - 1 >= this.options.retries)
      return { allowed: false, attempt: this.attemptValue, delay: 0 }
    const attempt = this.attemptValue + 1
    return { allowed: true, attempt, delay: calculateReconnectDelay(this.options, attempt, this.random) }
  }

  reset(): void {
    this.attemptValue = 0
    this.openedAt = null
  }
}
