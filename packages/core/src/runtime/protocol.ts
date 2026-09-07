/** 把应用协议与连接扩展在注册位置配对，避免异构协议列表和独立工厂失去类型关联。 */
import type { BeforeReconnectHandler, ProtocolAdapter, ProtocolFrame } from '../shared/types'
import type { NormalizedProtocolDescriptor } from '../config/normalize'
import { assertStructuredCloneable, isPlainRecord } from '../shared/structured'
import { validateProtocolAdapter } from '../protocol/adapter'
import { invokeSynchronous } from '../shared/callbacks'
import { SocketFuseError } from '../shared/errors'

/** 提供给连接作用域 hook 的当前安全上下文，不暴露完整 URL、socket 或页面。 */
export interface ConnectionExtensionContext {
  /** 应用命名的共享连接 id，不是授权边界。 */
  readonly connectionId: string
  /** 当前 endpoint 的 origin。 */
  readonly endpointOrigin: string
  /** 当前连接条目身份。 */
  readonly connectionEpoch: string
  /** 当前 epoch 的物理尝试编号。 */
  readonly attempt: number
}

/** 应用对一个物理 data/control 帧返回的有界协议效果。 */
export interface FrameResult<Incoming, Outgoing> {
  /** 消费协议帧或向页面投影一个业务值。 */
  readonly delivery: { readonly type: 'consume' } | { readonly type: 'broadcast', readonly data: Incoming }
  /** 可选的一次当前尝试协议回复；不进入出站队列。 */
  readonly reply?: Outgoing
  /** 可选重连意图；默认计数，不计数也不重置已有预算。 */
  readonly reconnect?: { readonly countAsRetry?: boolean }
}

/** 进入连接帧处理器的协议分类，不包含引擎已经消费的 ping/pong。 */
export type ConnectionFrame<Decoded> = Extract<ProtocolFrame<Decoded>, { readonly type: 'data' | 'control' }>

/** 一条连接的应用状态与同步帧处理；只允许准备 hook 异步执行。 */
export interface ConnectionExtension<Decoded = unknown, Outgoing = unknown, Incoming = Decoded> {
  /** 当前 socket 打开后、页面 open 通知前初始化连接协议状态。 */
  readonly onSocketOpen?: (context: Readonly<ConnectionExtensionContext>) => void
  /** 每次物理尝试结束只调用一次，旧尝试不清理新尝试状态。 */
  readonly onSocketClose?: (context: Readonly<ConnectionExtensionContext>) => void
  /** 每物理帧一次的同步协议处理；回放不会重新调用。 */
  readonly onFrame?: (frame: ConnectionFrame<Decoded>, context: Readonly<ConnectionExtensionContext>) => FrameResult<Incoming, Outgoing>
  /** 存在该心跳组时作为当前连接唯一生成来源，调度仍归连接引擎。 */
  readonly createPing?: (context: Readonly<ConnectionExtensionContext>) => Outgoing
  /** 心跳组中的服务端 ping 回复生成；不会与 adapter 对同帧重复执行。 */
  readonly createPong?: (frame: ProtocolFrame<Decoded>, context: Readonly<ConnectionExtensionContext>) => Outgoing
  /** 有总期限和取消信号的 URL/delay 准备；存在时页面候选不参与。 */
  readonly prepareAttempt?: BeforeReconnectHandler
  /** 条目完整回收时同步释放应用状态。 */
  readonly dispose?: () => void
}

/** 扩展工厂按连接实例化，Decoded/Outgoing 与该注册项 adapter 绑定。 */
export type ConnectionExtensionFactory<Decoded = unknown, Outgoing = unknown, Incoming = Decoded>
  = (context: Readonly<ConnectionExtensionContext>) => ConnectionExtension<Decoded, Outgoing, Incoming>

/** 准备上下文与页面 hook 共用同一 URL/delay 权限。 */
export type AttemptPreparationContext = Parameters<BeforeReconnectHandler>[0]

/** 异构注册表内部的一对协议实现和对应扩展，不再分别推断泛型。 */
export interface BoundConnectionProtocol {
  /** 与 extension 一起擦除的协议泛型。 */
  readonly adapter: ProtocolAdapter<unknown, unknown>
  /** 仅处理同一 adapter 解码值的扩展。 */
  readonly extension: ConnectionExtension | undefined
}

/** 自定义 Worker 静态注册记录，由 defineWorkerProtocol 建立类型配对。 */
export interface WorkerProtocolRegistration {
  /** 与页面 custom descriptor 精确匹配的静态身份。 */
  readonly descriptor: NormalizedProtocolDescriptor
}

/** 注册句柄只通过库创建，内部绑定函数不暴露给应用替换或伪造。 */
const bindings = new WeakMap<WorkerProtocolRegistration, (context: Readonly<ConnectionExtensionContext>) => BoundConnectionProtocol>()

/** 验证注册句柄确由 defineWorkerProtocol 创建。 */
export function isWorkerProtocolRegistration(value: unknown): value is WorkerProtocolRegistration {
  return value !== null && typeof value === 'object' && bindings.has(value as WorkerProtocolRegistration)
}

/** 执行库持有的绑定函数，应用工厂只经过自己的同步阶段校验一次。 */
export function bindWorkerProtocol(registration: WorkerProtocolRegistration, context: Readonly<ConnectionExtensionContext>): BoundConnectionProtocol {
  // 库私有保存的配对函数，公开句柄不能替换它。
  const bind = bindings.get(registration)
  if (bind === undefined)
    throw new SocketFuseError('INVALID_OPTIONS')
  return bind(context)
}

/**
 * 将同步协议和连接扩展工厂配对，用于自定义 Worker 的 protocols 注册表。
 * @param options adapter 决定解码/出站类型；扩展可产生独立页面投影类型。
 * @returns 可放入异构 Worker 注册列表的静态记录。
 * @throws INVALID_OPTIONS，协议身份、同步方法形状或静态配置无效时。
 */
export function defineWorkerProtocol<Decoded, Outgoing, Incoming = Decoded>(options: {
  readonly adapter: ProtocolAdapter<Decoded, Outgoing>
  readonly createExtension?: ConnectionExtensionFactory<NoInfer<Decoded>, NoInfer<Outgoing>, Incoming>
}): WorkerProtocolRegistration {
  if (!isPlainRecord(options) || Object.values(Object.getOwnPropertyDescriptors(options)).some(property => !('value' in property))
    || (options.createExtension !== undefined && typeof options.createExtension !== 'function'))
    throw new SocketFuseError('INVALID_OPTIONS')
  validateProtocolAdapter(options.adapter)
  assertStructuredCloneable(options.adapter.sharedConfig ?? {})
  // 复制静态协议配置，避免调用方后续修改输入。
  const adapter = Object.freeze({ ...options.adapter, sharedConfig: structuredClone(options.adapter.sharedConfig ?? {}) })
  // 注册时固定的连接状态工厂。
  const factory = options.createExtension
  // 公开描述每次返回独立快照，不能借嵌套配置引用改变已注册的匹配身份。
  const descriptor: NormalizedProtocolDescriptor = { id: adapter.id, kind: 'custom', version: adapter.version, sharedConfig: adapter.sharedConfig }
  // 只暴露描述副本的不可替换注册句柄。
  const registration = Object.freeze({
    /** 读取注册时固定的身份；调用方可修改自己的副本。 */
    get descriptor(): NormalizedProtocolDescriptor {
      return structuredClone(descriptor)
    },
  })
  // 只在这一配对边界擦除异构泛型，runtime 不能拆开重配两者。
  bindings.set(registration, context => ({ adapter: adapter as unknown as ProtocolAdapter<unknown, unknown>,
    extension: factory === undefined ? undefined : invokeSynchronous(() => factory(context), 'PROTOCOL_ERROR') as ConnectionExtension }))
  return registration
}
