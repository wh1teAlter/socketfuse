/**
 * 在 transport 层选择一个页面准备 connection 重连计划；不执行页面函数，也不拥有 socket。
 */
import type { ReconnectPlan, ReconnectPlanOverride } from '../connection/controller'
import type { ClientVisibility, TimerHandle } from '../shared/types'
import { SocketFuseError } from '../shared/errors'

/** reconnect plan 候选协调器的边界回调。 */
export interface ReconnectCoordinatorCallbacks {
  /** 把准备权交给唯一候选。 */
  readonly onAssign: (clientId: string, plan: Readonly<ReconnectPlan>) => void
  /** 候选失效时通知页面 abort 本地 hook。 */
  readonly onAbort: (clientId: string, planId: string) => void
  /** 成功覆盖或全部失败后原子提交到 connection。 */
  readonly onCommit: (planId: string, override: Readonly<ReconnectPlanOverride>) => void
}

/** reconnect plan 协调器的时钟与准备窗口。 */
export interface ReconnectCoordinatorOptions extends ReconnectCoordinatorCallbacks {
  /** 整个重连计划的总准备窗口，单位为毫秒。 */
  readonly timeout: number
  /** 可注入的 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 与 timer 工厂配对的清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
}

/** 单个页面的重连计划候选记录。 */
interface ReconnectCandidate {
  /** 页面逻辑 client id。 */
  readonly clientId: string
  /** 注册 FIFO 序号。 */
  readonly order: number
  /** Worker 最近确认的页面执行活性。 */
  visibility: ClientVisibility
}

/** 当前重连计划的 owner、已尝试集合和总截止 timer。 */
interface ActivePlan {
  /** connection 创建的不可变计划。 */
  readonly plan: Readonly<ReconnectPlan>
  /** 本计划已经尝试过的候选，避免失败循环。 */
  readonly tried: Set<string>
  /** 当前唯一准备者。 */
  owner: string | undefined
  /** 整个计划唯一的总截止 timer。 */
  timer: TimerHandle | undefined
}

/** 为 SharedWorker 与 direct pool 提供相同的非抢占候选选择语义。 */
export class ReconnectCoordinator {
  /** client id 到候选状态。 */
  private readonly candidates = new Map<string, ReconnectCandidate>()
  /** 注册顺序的单调序号。 */
  private sequence = 0
  /** 当前待提交计划。 */
  private active: ActivePlan | undefined
  /** timer 工厂。 */
  private readonly setTimer: (callback: () => void, delay: number) => TimerHandle
  /** timer 清理函数。 */
  private readonly clearTimer: (handle: TimerHandle) => void

  /** 创建有界候选协调器。 */
  constructor(private readonly options: ReconnectCoordinatorOptions) {
    this.setTimer = options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay))
    this.clearTimer = options.clearTimeout ?? (handle => globalThis.clearTimeout(handle))
  }

  /** 注册或更新候选，不抢占当前 plan owner。 */
  register(clientId: string, visibility: ClientVisibility): void {
    const existing = this.candidates.get(clientId)
    if (existing !== undefined) {
      existing.visibility = visibility
      return
    }
    this.candidates.set(clientId, { clientId, order: ++this.sequence, visibility })
  }

  /** 注销候选；若其正在准备则 abort 并转交。 */
  unregister(clientId: string): void {
    this.candidates.delete(clientId)
    if (this.active?.owner === clientId)
      this.failOwner(true)
  }

  /** 更新活性；hidden 不抢占，frozen owner 立即转交。 */
  setVisibility(clientId: string, visibility: ClientVisibility): void {
    const candidate = this.candidates.get(clientId)
    if (candidate === undefined)
      return
    candidate.visibility = visibility
    if (visibility === 'frozen' && this.active?.owner === clientId)
      this.failOwner(true)
  }

  /** 接管 connection 新计划；没有可用候选时返回 false 让 connection 采用默认值。 */
  start(plan: Readonly<ReconnectPlan>): boolean {
    this.cancelActive()
    if (!this.hasEligibleCandidate())
      return false
    this.active = { owner: undefined, plan, timer: undefined, tried: new Set() }
    const active = this.active
    active.timer = this.setTimer(() => this.expire(active), this.options.timeout)
    this.assignNext()
    return true
  }

  /** 接受当前 owner 的原子覆盖并提交。 */
  accept(clientId: string, planId: string, override: Readonly<ReconnectPlanOverride>): void {
    const active = this.requireOwner(clientId, planId)
    this.options.onCommit(planId, override)
    this.clearActiveTimer(active)
    this.active = undefined
  }

  /** 当前 owner 主动放弃 plan，并选择下一个候选。 */
  reject(clientId: string, planId: string): void {
    this.requireOwner(clientId, planId)
    this.failOwner(false)
  }

  /** connection 显式取消仍在等待的指定计划。 */
  cancel(planId: string): void {
    if (this.active?.plan.id === planId)
      this.cancelActive()
  }

  /** 停止当前准备窗口并 abort owner。 */
  dispose(): void {
    this.cancelActive()
    this.candidates.clear()
  }

  /** 判断是否存在未冻结候选。 */
  private hasEligibleCandidate(): boolean {
    return [...this.candidates.values()].some(candidate => candidate.visibility !== 'frozen')
  }

  /** 选择 visible 优先、组内 FIFO 且本 plan 未尝试的候选。 */
  private assignNext(): void {
    const active = this.active
    if (active === undefined)
      return
    const selected = [...this.candidates.values()]
      .filter(candidate => candidate.visibility !== 'frozen' && !active.tried.has(candidate.clientId))
      .sort((left, right) => {
        const leftRank = left.visibility === 'visible' ? 0 : 1
        const rightRank = right.visibility === 'visible' ? 0 : 1
        return leftRank - rightRank || left.order - right.order
      })[0]
    if (selected === undefined) {
      this.clearActiveTimer(active)
      this.active = undefined
      try {
        this.options.onCommit(active.plan.id, {})
      }
      catch {
        // controller 可能已被显式 close/dispose；计划已失效时不能让 timer 回调冒泡为未捕获异常。
      }
      return
    }
    active.owner = selected.clientId
    active.tried.add(selected.clientId)
    try {
      this.options.onAssign(selected.clientId, active.plan)
    }
    catch {
      // 页面 sink 属于 transport 边界；单个候选投递失败只撤销该候选并继续 FIFO 转移。
      if (this.active === active && active.owner === selected.clientId)
        this.failOwner(false)
      return
    }
  }

  /** 终止当前 owner，可选通知页面，再继续同一 plan。 */
  private failOwner(notify: boolean): void {
    const active = this.active
    if (active === undefined || active.owner === undefined)
      return
    const owner = active.owner
    active.owner = undefined
    if (notify) {
      try {
        this.options.onAbort(owner, active.plan.id)
      }
      catch {
        // 撤销通知失败不应阻止后继候选接管同一计划。
      }
    }
    this.assignNext()
  }

  /** 总截止时间到达后撤销当前 owner，并立即采用计划默认值。 */
  private expire(active: ActivePlan): void {
    if (this.active !== active)
      return
    active.timer = undefined
    if (active.owner !== undefined) {
      try {
        this.options.onAbort(active.owner, active.plan.id)
      }
      catch {
        // owner 端口失效不影响 Worker 按默认计划继续。
      }
    }
    this.active = undefined
    try {
      this.options.onCommit(active.plan.id, {})
    }
    catch {
      // controller 可能已关闭或释放；过期计划不得产生未捕获异常。
    }
  }

  /** 校验提交者仍是当前 plan owner。 */
  private requireOwner(clientId: string, planId: string): ActivePlan {
    const active = this.active
    if (active === undefined || active.plan.id !== planId || active.owner !== clientId)
      throw new SocketFuseError('STALE_RECONNECT_PLAN', 'Reconnect plan is no longer owned by this client')
    return active
  }

  /** 清理当前候选准备 timer。 */
  private clearActiveTimer(active: ActivePlan): void {
    if (active.timer !== undefined)
      this.clearTimer(active.timer)
    active.timer = undefined
  }

  /** 在新计划或 dispose 前使旧 owner 失效。 */
  private cancelActive(): void {
    const active = this.active
    if (active === undefined)
      return
    this.clearActiveTimer(active)
    if (active.owner !== undefined) {
      try {
        this.options.onAbort(active.owner, active.plan.id)
      }
      catch {
        // 端口已经失效时无需再次向上抛出撤销通知异常。
      }
    }
    this.active = undefined
  }
}
