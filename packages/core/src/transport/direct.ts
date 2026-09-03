/** 在当前 JavaScript realm 内复用连接控制器，作为 SharedWorker 不可用时的降级通道。 */
import type {
  ClientVisibility,
  ConnectionSnapshot,
  SendOptions,
  SendReceipt,
  SocketData,
  WebSocketClient,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { WebSocketFactory } from './socket'
import { ConnectionController, type ConnectionControllerOptions, type ConnectionSink, type ReconnectPlan, type ReconnectPlanOverride } from '../connection/controller'
import { ReconnectCoordinator } from './reconnect-coordinator'
import { SocketFuseError } from '../shared/errors'

/** connection sink 加上 transport 控制面在页面触发的事件。 */
export interface ClientTransportSink<Incoming> extends ConnectionSink<Incoming> {
  /** execution key 的实际授权变化。 */
  readonly onKeyChange?: (key: string, held: boolean) => void
  /** frozen 候选已越过 Worker revoke 屏障，不表示公开授权变化。 */
  readonly onKeyBarrier?: (key: string) => void
  /** 当前页面被选中准备一次重连计划。 */
  readonly onBeforeReconnect?: (plan: Readonly<ReconnectPlan>) => void
  /** 当前页面的重连计划准备权已撤销。 */
  readonly onReconnectAbort?: (planId: string) => void
}

export interface ClientTransport<Incoming, Outgoing> {
  /** 当前选定的物理 transport 类型。 */
  readonly kind: 'direct' | 'shared-worker'
  /** Worker 部署方式；direct 时为 none。 */
  readonly workerMode: 'none' | 'inline' | 'custom'
  /** 绑定页面 sink。 */
  attach: (sink: ClientTransportSink<Incoming>) => void
  /** 打开连接并返回快照。 */
  open: (signal?: AbortSignal) => Promise<ConnectionSnapshot>
  /** 关闭当前逻辑 client。 */
  close: () => Promise<void>
  /** 发送业务值并返回本地接纳回执。 */
  send: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  /** 注册页面对 execution key 的候选资格。 */
  registerExclusiveKey: (key: string) => Promise<void>
  /** 注销页面对 execution key 的候选资格。 */
  unregisterExclusiveKey: (key: string) => Promise<void>
  /** 更新 Worker 选主使用的页面执行活性。 */
  setVisibility: (visibility: ClientVisibility) => void
  /** 注册或注销当前页面的重连 hook 候选资格。 */
  setReconnectHook: (enabled: boolean) => Promise<void>
  /** 原子提交当前页面拥有的重连计划草案。 */
  completeReconnectPlan: (planId: string, override: Readonly<ReconnectPlanOverride>) => Promise<void>
  /** 当前页面 hook 失败时放弃计划。 */
  rejectReconnectPlan: (planId: string) => Promise<void>
  /** 请求物理连接重连。 */
  reconnect: () => Promise<void>
  /** 生命周期恢复期间验证选定的 SharedWorker 实例。 */
  probe?: () => Promise<string>
  suspend?: () => void
  restore?: () => void
  /** 脱离指定页面 client。 */
  detach: (clientId: string) => void
  /** 返回已脱敏的诊断快照。 */
  diagnostics: () => Readonly<Record<string, unknown>>
  /** 释放 transport 对连接池的所有权。 */
  dispose: () => void
}

export interface DirectTransportOptions<Incoming, Outgoing> {
  /** 页面和物理连接共享的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing>
  /** 当前页面 client id。 */
  readonly clientId: string
  /** 可选测试 WebSocket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 注入时钟和 timer 的连接控制器选项。 */
  readonly controllerOptions?: Omit<ConnectionControllerOptions<Incoming, Outgoing>, 'config' | 'socketFactory'>
}

interface DirectPoolEntry {
  /** 用于检测同 id 配置冲突的 canonical。 */
  readonly canonical: string
  /** 池中唯一物理连接控制器。 */
  readonly controller: ConnectionController<unknown, unknown>
  /** 当前 realm 内页面重连 hook 的单候选协调器。 */
  readonly reconnect: ReconnectCoordinator
  /** client id 到 direct transport 的事件目标。 */
  readonly transports: Map<string, DirectTransport<unknown, unknown>>
  /** 当前页面 transport 引用数。 */
  references: number
}

/** 同一 realm 内 direct transport 的连接池。 */
const directPool: Map<string, DirectPoolEntry> = new Map()

export class DirectTransport<Incoming, Outgoing> implements ClientTransport<Incoming, Outgoing> {
  /** transport 类型固定为 direct。 */
  readonly kind = 'direct' as const
  /** direct 不依赖 Worker。 */
  readonly workerMode = 'none' as const
  /** 池中共享的物理连接控制器。 */
  readonly controller: ConnectionController<Incoming, Outgoing>
  /** 当前页面 owner id。 */
  private readonly clientId: string
  /** 是否已从池中释放引用。 */
  private released = false
  /** 页面当前绑定的 transport sink。 */
  private sink: ClientTransportSink<Incoming> | undefined
  /** 页面声明且在 attach 时自动恢复的 execution keys。 */
  private readonly exclusiveKeys = new Set<string>()
  /** 当前是否已经作为逻辑 client 附着。 */
  private attached = false
  /** 当前池条目，统一访问 reconnect coordinator。 */
  private readonly poolEntry: DirectPoolEntry
  /** 页面是否声明了重连 hook。 */
  private reconnectHook = false
  /** direct coordinator 使用的页面活性。 */
  private visibility: ClientVisibility = 'visible'

  /** 创建或复用当前 realm 的 direct 物理连接。 */
  constructor(readonly options: DirectTransportOptions<Incoming, Outgoing>) {
    this.clientId = options.clientId
    const existing = directPool.get(options.config.id)
    if (existing !== undefined) {
      if (existing.canonical !== options.config.configCanonical)
        throw new SocketFuseError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      existing.references++
      this.controller = existing.controller as ConnectionController<Incoming, Outgoing>
      this.poolEntry = existing
    }
    else {
      const transports = new Map<string, DirectTransport<unknown, unknown>>()
      /** 协调器回调只会在 controller 完成构造并开始连接后执行。 */
      const controllerHolder: { current?: ConnectionController<Incoming, Outgoing> } = {}
      const reconnect = new ReconnectCoordinator({
        ...(options.controllerOptions?.clearTimeout === undefined ? {} : { clearTimeout: options.controllerOptions.clearTimeout }),
        onAbort: (clientId, planId) => transports.get(clientId)?.sink?.onReconnectAbort?.(planId),
        onAssign: (clientId, plan) => transports.get(clientId)?.sink?.onBeforeReconnect?.(plan),
        onCommit: (planId, override) => {
          const current = controllerHolder.current
          if (current === undefined)
            throw new SocketFuseError('INTERNAL_STATE_ERROR', 'Direct reconnect controller is unavailable')
          current.commitReconnectPlan(planId, override)
        },
        ...(options.controllerOptions?.setTimeout === undefined ? {} : { setTimeout: options.controllerOptions.setTimeout }),
        timeout: options.config.shared.reconnect === false ? 10_000 : options.config.shared.reconnect.hookTimeout,
      })
      const controllerOptions: ConnectionControllerOptions<Incoming, Outgoing> = options.socketFactory === undefined
        ? { ...options.controllerOptions, config: options.config, onReconnectPlan: plan => reconnect.start(plan), onReconnectPlanCancel: planId => reconnect.cancel(planId) }
        : { ...options.controllerOptions, config: options.config, onReconnectPlan: plan => reconnect.start(plan), onReconnectPlanCancel: planId => reconnect.cancel(planId), socketFactory: options.socketFactory }
      const controller = new ConnectionController(controllerOptions)
      controllerHolder.current = controller
      this.controller = controller
      this.poolEntry = {
        canonical: options.config.configCanonical,
        controller: this.controller as ConnectionController<unknown, unknown>,
        reconnect,
        references: 1,
        transports,
      }
      directPool.set(options.config.id, this.poolEntry)
    }
    this.poolEntry.transports.set(this.clientId, this as DirectTransport<unknown, unknown>)
  }

  /** 附加页面 sink。失败会同步抛出资源或配置错误。 */
  attach(sink: ClientTransportSink<Incoming>): void {
    this.sink = sink
    this.attached = true
    try {
      this.controller.attach(sink)
    }
    catch (error) {
      // controller 资源上限拒绝时，不能留下一个没有 sink 的 direct
      // client；否则后续 close/dispose 会错误地影响连接池引用。
      this.sink = undefined
      this.attached = false
      throw error
    }
    if (this.reconnectHook)
      this.poolEntry.reconnect.register(this.clientId, this.visibility)
    for (const key of this.exclusiveKeys)
      sink.onKeyChange?.(key, true)
  }

  /** 打开物理连接并等待 ready。 */
  open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    return this.controller.open(signal)
  }

  /** 只 detach 当前逻辑 client，不立即强制关闭共享 controller。 */
  async close(): Promise<void> {
    if (this.attached) {
      for (const key of this.exclusiveKeys)
        this.sink?.onKeyChange?.(key, false)
    }
    this.attached = false
    this.poolEntry.reconnect.unregister(this.clientId)
    this.controller.detach(this.clientId)
  }

  /** 编码并发送当前页面拥有的业务值。 */
  send(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    return this.controller.send(this.clientId, data, options)
  }

  /** direct 模式把当前 client 视为其 key 的 holder。 */
  async registerExclusiveKey(key: string): Promise<void> {
    if (this.exclusiveKeys.has(key))
      return
    this.exclusiveKeys.add(key)
    if (this.attached)
      this.sink?.onKeyChange?.(key, true)
  }

  /** 删除 direct 页面 key，并同步撤销本地授权。 */
  async unregisterExclusiveKey(key: string): Promise<void> {
    if (!this.exclusiveKeys.delete(key))
      return
    if (this.attached)
      this.sink?.onKeyChange?.(key, false)
  }

  /** direct 不跨页面仲裁 key，但复用可见性选择重连 hook。 */
  setVisibility(visibility: ClientVisibility): void {
    const wasFrozen = this.visibility === 'frozen'
    this.visibility = visibility
    this.poolEntry.reconnect.setVisibility(this.clientId, visibility)
    if (!this.attached || wasFrozen === (visibility === 'frozen'))
      return
    for (const key of this.exclusiveKeys)
      this.sink?.onKeyChange?.(key, visibility !== 'frozen')
  }

  /** 更新 direct 页面对重连计划的候选资格。 */
  async setReconnectHook(enabled: boolean): Promise<void> {
    this.reconnectHook = enabled
    if (!this.attached)
      return
    if (enabled)
      this.poolEntry.reconnect.register(this.clientId, this.visibility)
    else
      this.poolEntry.reconnect.unregister(this.clientId)
  }

  /** 提交 direct 页面当前拥有的重连计划。 */
  async completeReconnectPlan(planId: string, override: Readonly<ReconnectPlanOverride>): Promise<void> {
    this.poolEntry.reconnect.accept(this.clientId, planId, override)
  }

  /** 放弃 direct 页面当前拥有的重连计划。 */
  async rejectReconnectPlan(planId: string): Promise<void> {
    this.poolEntry.reconnect.reject(this.clientId, planId)
  }

  /** 显式请求物理连接重连。 */
  reconnect(): Promise<void> {
    return this.controller.reconnect()
  }

  /** 从 controller 脱离指定页面 owner。 */
  detach(clientId: string): void {
    this.controller.detach(clientId)
  }

  /** 返回 direct controller 的安全诊断。 */
  diagnostics(): Readonly<Record<string, unknown>> {
    return this.controller.diagnostics(this.kind)
  }

  /** 幂等释放池引用，最后一个引用释放时销毁 controller。 */
  dispose(): void {
    if (this.released)
      return
    this.released = true
    if (this.attached) {
      for (const key of this.exclusiveKeys)
        this.sink?.onKeyChange?.(key, false)
    }
    this.attached = false
    this.poolEntry.reconnect.unregister(this.clientId)
    this.poolEntry.transports.delete(this.clientId)
    this.controller.detach(this.clientId)
    const entry = directPool.get(this.options.config.id)
    if (entry === undefined)
      return
    entry.references--
    if (entry.references <= 0) {
      directPool.delete(this.options.config.id)
      entry.reconnect.dispose()
      entry.controller.dispose()
    }
  }
}

/** 在创建 direct transport 前确认当前 realm 提供 WebSocket。 */
export function assertDirectEnvironment(): void {
  if (typeof WebSocket === 'undefined')
    throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED', 'WebSocket is not available in this environment')
}

export type { SocketData, WebSocketClient }
