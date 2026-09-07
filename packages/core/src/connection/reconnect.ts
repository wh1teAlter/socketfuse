/** 维护共享连接的计数预算与连续稳定窗口；物理 attempt 和计划身份由连接控制器拥有。 */
import type { ReconnectOptions } from '../shared/types'
import { SocketFuseError } from '../shared/errors'

/** 按当前计数序号计算最终整数退避，抖动之后仍不得超过 maxDelay。 */
export function calculateReconnectDelay(options: Readonly<ReconnectOptions>, attempt: number, random: () => number = Math.random): number {
  if (!Number.isSafeInteger(attempt) || attempt <= 0 || options.initialDelay === 0)
    return 0
  const base = Math.min(options.maxDelay, options.initialDelay * options.factor ** (attempt - 1))
  const value = random()
  const sample = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5
  return Math.round(Math.min(options.maxDelay, Math.max(0, base * (1 - options.jitter + 2 * options.jitter * sample))))
}

/** 一条连接 epoch 内的预算，至多一个计数预留；不计数请求不改变已用数量。 */
export class ReconnectPolicy {
  /** 已实际启动的计数重连数；首次 socket 不经过此计数器。 */
  private usedValue = 0
  /** 已接纳但尚未调用 socket 工厂的计数预留。 */
  private reservedValue: 0 | 1 = 0
  /** 当前物理尝试连续 open 的起点；关闭、计划接纳或重置后为空。 */
  private openedAt: number | null = null

  /** 使用不可变共享策略创建连接预算。 */
  constructor(readonly options: Readonly<ReconnectOptions>) {}

  /** 返回已启动的计数尝试数。 */
  get used(): number {
    return this.usedValue
  }

  /** 返回尚未启动的计数预留。 */
  get reserved(): 0 | 1 {
    return this.reservedValue
  }

  /** 返回扣除已用和预留后可接纳的计数次数。 */
  get remaining(): number {
    return Math.max(0, this.options.maxRetries - this.usedValue - this.reservedValue)
  }

  /** 记录当前尝试的连续 open 起点；断线时间不能被借用。 */
  recordOpen(now: number): void {
    this.openedAt = now
  }

  /** 仅结算已经达到阈值的连续 open；返回是否执行过预算重置。 */
  settleStable(now: number): boolean {
    if (this.options.stableThreshold === false || this.openedAt === null || now - this.openedAt < this.options.stableThreshold)
      return false
    this.usedValue = 0
    this.openedAt = null
    return true
  }

  /** 封存当前连续 open 窗口，禁止关闭/准备/退避时间继续累计。 */
  endOpen(now: number): void {
    this.settleStable(now)
    this.openedAt = null
  }

  /** 先检查容量并预留，调用方成功后才可关闭健康 socket。 */
  reserve(countAsRetry: boolean): void {
    if (!countAsRetry)
      return
    if (this.reservedValue !== 0)
      throw new SocketFuseError('RECONNECT_IN_PROGRESS')
    if (this.remaining === 0)
      throw new SocketFuseError('RETRY_EXHAUSTED', { retryable: true })
    this.reservedValue = 1
  }

  /** 在即将调用 socket 工厂时把预留转成已用；构造抛错也不退回。 */
  start(countAsRetry: boolean): void {
    if (!countAsRetry)
      return
    if (this.reservedValue !== 1)
      throw new SocketFuseError('INTERNAL_STATE_ERROR', { fatal: true })
    this.reservedValue = 0
    this.usedValue++
  }

  /** 取消尚未启动的计划，只释放预留，不补充已用预算。 */
  cancel(): void {
    this.reservedValue = 0
  }
}
