/** 在当前 JavaScript realm 内复用连接控制器，作为 SharedWorker 不可用时的降级通道。 */
import type {
  ConnectionSnapshot,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  SocketData,
  WebSocketClient,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { WebSocketFactory } from './socket'
import { ConnectionController, type ConnectionControllerOptions, type ConnectionSink } from '../connection/controller'
import { SocketFuseError } from '../shared/errors'

export interface ClientTransport<Incoming, Outgoing, Auth> {
  /** 当前选定的物理 transport 类型。 */
  readonly kind: 'direct' | 'shared-worker'
  /** Worker 部署方式；direct 时为 none。 */
  readonly workerMode: 'none' | 'inline' | 'custom'
  /** 选定协议支持的能力。 */
  readonly capabilities: ProtocolCapabilities
  /** 绑定页面 sink。 */
  attach: (sink: ConnectionSink<Incoming>) => void
  /** 打开连接并返回快照。 */
  open: (signal?: AbortSignal) => Promise<ConnectionSnapshot>
  /** 关闭当前逻辑 client。 */
  close: () => void
  /** 发送业务值并返回本地接纳回执。 */
  send: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  /** 更新认证 revision。 */
  updateAuth: (value: Auth, revision: number) => Promise<RevisionReceipt>
  /** 清除认证 revision。 */
  clearAuth: (revision: number) => Promise<RevisionReceipt>
  /** 更新 endpoint revision。 */
  updateUrl: (url: string, revision: number) => Promise<RevisionReceipt>
  /** 请求物理连接重连。 */
  reconnect: (reason?: string) => Promise<void>
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

export interface DirectTransportOptions<Incoming, Outgoing, Auth> {
  /** 页面和物理连接共享的规范化配置。 */
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  /** 当前页面 client id。 */
  readonly clientId: string
  /** 可选测试 WebSocket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 注入时钟和 timer 的连接控制器选项。 */
  readonly controllerOptions?: Omit<ConnectionControllerOptions<Incoming, Outgoing, Auth>, 'config' | 'socketFactory'>
}

interface DirectPoolEntry {
  /** 用于检测同 id 配置冲突的 canonical。 */
  readonly canonical: string
  /** 池中唯一物理连接控制器。 */
  readonly controller: ConnectionController<unknown, unknown, unknown>
  /** 当前页面 transport 引用数。 */
  references: number
}

/** 同一 realm 内 direct transport 的连接池。 */
const directPool: Map<string, DirectPoolEntry> = new Map()

export class DirectTransport<Incoming, Outgoing, Auth = unknown> implements ClientTransport<Incoming, Outgoing, Auth> {
  /** transport 类型固定为 direct。 */
  readonly kind = 'direct' as const
  /** direct 不依赖 Worker。 */
  readonly workerMode = 'none' as const
  /** adapter 能力快照。 */
  readonly capabilities: ProtocolCapabilities
  /** 池中共享的物理连接控制器。 */
  readonly controller: ConnectionController<Incoming, Outgoing, Auth>
  /** 当前页面 owner id。 */
  private readonly clientId: string
  /** 是否已从池中释放引用。 */
  private released = false

  /** 创建或复用当前 realm 的 direct 物理连接。 */
  constructor(readonly options: DirectTransportOptions<Incoming, Outgoing, Auth>) {
    this.clientId = options.clientId
    this.capabilities = options.config.adapter.capabilities
    const existing = directPool.get(options.config.id)
    if (existing !== undefined) {
      if (existing.canonical !== options.config.configCanonical)
        throw new SocketFuseError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      if (existing.controller.endpointRevision === 0 && existing.controller.endpointUrl !== options.config.url)
        throw new SocketFuseError('CONNECTION_CONFIG_CONFLICT', 'Initial endpoint conflicts with the current endpoint')
      existing.references++
      this.controller = existing.controller as ConnectionController<Incoming, Outgoing, Auth>
    }
    else {
      const controllerOptions: ConnectionControllerOptions<Incoming, Outgoing, Auth> = options.socketFactory === undefined
        ? { ...options.controllerOptions, config: options.config }
        : { ...options.controllerOptions, config: options.config, socketFactory: options.socketFactory }
      this.controller = new ConnectionController(controllerOptions)
      directPool.set(options.config.id, {
        canonical: options.config.configCanonical,
        controller: this.controller as ConnectionController<unknown, unknown, unknown>,
        references: 1,
      })
    }
  }

  /** 附加页面 sink。失败会同步抛出资源或配置错误。 */
  attach(sink: ConnectionSink<Incoming>): void {
    this.controller.attach(sink)
  }

  /** 打开物理连接并等待 ready。 */
  open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    return this.controller.open(signal)
  }

  /** 只 detach 当前逻辑 client，不立即强制关闭共享 controller。 */
  close(): void {
    this.controller.detach(this.clientId)
  }

  /** 编码并发送当前页面拥有的业务值。 */
  send(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    return this.controller.send(this.clientId, data, options)
  }

  /** 提交认证 revision。 */
  updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    return this.controller.updateAuth(value, revision)
  }

  /** 提交清除认证 revision。 */
  clearAuth(revision: number): Promise<RevisionReceipt> {
    return this.controller.clearAuth(revision)
  }

  /** 提交 endpoint revision。 */
  updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    return this.controller.updateUrl(url, revision)
  }

  /** 显式请求物理连接重连。 */
  reconnect(reason?: string): Promise<void> {
    return this.controller.reconnect(reason)
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
    this.controller.detach(this.clientId)
    const entry = directPool.get(this.options.config.id)
    if (entry === undefined)
      return
    entry.references--
    if (entry.references <= 0) {
      directPool.delete(this.options.config.id)
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
