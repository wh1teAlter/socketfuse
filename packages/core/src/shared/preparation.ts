/** 有总期限与未结算容量的应用准备调用；取消事务不假装能强制终止用户 Promise。 */
import type { BeforeReconnectContext, BeforeReconnectHandler, TimerHandle } from './types'
import { normalizeEndpointUrl } from './endpoint'
import { SocketFuseError } from './errors'

/** 同一 realm 中尚未真实 settle 的准备调用数。 */
let unsettled = 0
/** 每个准备来源最多一个未 settle 调用；source 使用无业务引用的小 token。 */
const busySources = new WeakSet<object>()

/** 准备 hook 可读取的计划描述，不含 endpoint。 */
export interface PreparationDescription extends Omit<BeforeReconnectContext, 'signal' | 'setOptions' | 'setDelay'> {
  /** 整个计划的绝对截止时间。 */
  readonly deadline: number
}

/** 当前事务允许一次提交的 URL 与等待覆盖。 */
export interface PreparationOverride {
  /** 只作为连接输入，不回显。 */
  readonly url?: string
  /** 平台范围内非负整数毫秒。 */
  readonly delay?: number
}

/** 准备调用的所有权边界；completion 在取消后立即释放。 */
export interface PreparationRuntime {
  /** 同源计划时钟。 */
  readonly now?: () => number
  /** 定时器工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 定时器清理。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** 同步重入取消发生在取消函数返回之前时，也立即停止 setter 授权。 */
  readonly isCurrent?: () => boolean
  /** 在调用应用函数之前发布取消能力，保证同步重入也立即 abort。 */
  readonly onStart?: (cancel: () => void) => void
  /** 当前准备失败或超期时报告稳定错误，不保存原始异常。 */
  readonly onFailure?: (error: SocketFuseError) => void
  /** 成功返回草案，失败/超期返回 undefined；取消不调用。 */
  readonly onComplete: (override: PreparationOverride | undefined) => void
}

/**
 * 启动一次有界准备，返回只终止本事务的取消函数。
 * @param source 来源小 token，不传入 client 或 controller 实例。
 * @param plan 当前授权的只读描述。
 * @param handler 用户异步准备 hook。
 * @param runtime 所属 realm 的时钟与结果接收者。
 * @throws PREPARATION_BUSY；没有容量时不排队也不调用用户函数。
 */
export function beginPreparation(source: object, plan: PreparationDescription, handler: BeforeReconnectHandler, runtime: PreparationRuntime): () => void {
  if (busySources.has(source) || unsettled >= 16)
    throw new SocketFuseError('PREPARATION_BUSY')
  busySources.add(source)
  unsettled++
  // 绝对 deadline 校验使用的毫秒时钟。
  const now = runtime.now ?? Date.now
  // 有界准备时限的 timer 工厂。
  const setTimer = runtime.setTimeout ?? ((callback: () => void, delay: number) => globalThis.setTimeout(callback, delay))
  // 取消本事务 timer 的配对函数。
  const clearTimer = runtime.clearTimeout ?? ((handle: TimerHandle) => globalThis.clearTimeout(handle))
  // 当前事务独占的协作取消信号。
  const abort = new AbortController()
  // 事务结束后仅这条小记录留在尚未 settle 的 Promise 回调中，不保留调用方连接引用。
  const state: { active: boolean, isCurrent: (() => boolean) | undefined, failure: PreparationRuntime['onFailure'], completion: PreparationRuntime['onComplete'] | undefined, draft: PreparationOverride, timer: TimerHandle | undefined } = {
    active: true, failure: runtime.onFailure, isCurrent: runtime.isCurrent, completion: runtime.onComplete, draft: {}, timer: undefined,
  }
  /** 禁止 timer 尚未调度时的过期 setter，也拒绝成功或取消后的写入。 */
  const requireActive = (): void => {
    if (!state.active || now() >= plan.deadline || state.isCurrent?.() === false)
      throw new SocketFuseError('STALE_RECONNECT_PLAN')
  }
  /** 先结束事务和释放草案，再 abort；重入不能覆盖已终结或后继事务。 */
  const finish = (succeeded: boolean, notify: boolean): void => {
    if (!state.active)
      return
    // 解除状态引用后再通知提交结果。
    const completion = state.completion
    // 失败通知不能保留已结束事务的闭包。
    const failure = state.failure
    // 只有期限内且仍有授权的成功结果才允许提交。
    const draft = succeeded && now() < plan.deadline && state.isCurrent?.() !== false ? state.draft : undefined
    state.active = false
    state.completion = undefined
    state.failure = undefined
    state.isCurrent = undefined
    state.draft = {}
    // 清理前移除 timer 引用，避免重入覆盖新状态。
    const timer = state.timer
    state.timer = undefined
    if (timer !== undefined)
      clearTimer(timer)
    abort.abort()
    if (notify) {
      if (!succeeded)
        failure?.(new SocketFuseError('PROTOCOL_ERROR'))
      completion?.(draft)
    }
  }
  // 调用方只可修改本计划的 URL 与等待时间。
  const context: BeforeReconnectContext = Object.freeze({ attempt: plan.attempt, defaultDelay: plan.defaultDelay,
    source: plan.source, countAsRetry: plan.countAsRetry, retriesUsed: plan.retriesUsed,
    close: Object.freeze({ ...plan.close }), reason: plan.reason, signal: abort.signal,
    /** URL 先全部验证再更新草案，异常不留下部分提交。 */
    setOptions(options: { readonly url: string }): void {
      requireActive()
      if (options === null || typeof options !== 'object' || Reflect.ownKeys(options).length !== 1
        || !Object.hasOwn(options, 'url') || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, 'url') ?? {}, 'value'))
        throw new SocketFuseError('INVALID_OPTIONS')
      // 校验后保存的 endpoint 草案，提交前不改变连接。
      const url = normalizeEndpointUrl(options.url)
      requireActive()
      state.draft = { ...state.draft, url }
    },
    /** 延迟与计数策略独立，setter 无权改变预算。 */
    setDelay(delay: number): void {
      requireActive()
      if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2_147_483_647)
        throw new SocketFuseError('INVALID_OPTIONS')
      state.draft = { ...state.draft, delay }
    },
  })
  state.timer = setTimer(() => finish(false, true), Math.max(0, plan.deadline - now()))
  /** 取消只结束授权，未结算 Promise 仍占来源额度。 */
  const cancel = (): void => finish(false, false)
  runtime.onStart?.(cancel)
  // 真实用户任务的结算用于归还未结算额度。
  let promise: Promise<void>
  try {
    promise = Promise.resolve(state.active ? handler(context) : undefined)
  }
  catch {
    promise = Promise.reject(new SocketFuseError('PROTOCOL_ERROR'))
  }
  /** 真实 settle 才释放来源和 realm 额度，取消不能提前补回容量。 */
  const settled = (succeeded: boolean): void => {
    busySources.delete(source)
    unsettled--
    finish(succeeded, true)
  }
  void promise.then(() => settled(true), () => settled(false)).catch(() => undefined)
  return cancel
}
