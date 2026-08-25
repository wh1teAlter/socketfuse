/**
 * 拥有 SharedWorker 端口、连接池与 Worker 级资源限制。
 *
 * hello 是 attach 的事务边界：只有配置重建、controller.attach 和 client 提交都成功，
 * 端口才成为已附着 client；任一失败都必须回滚临时连接和端口 timer。
 */
import type { JsonProtocolOptions, NormalizedRestoreOptions, ProtocolAdapter, TimerHandle, WorkerResourceLimits } from '../shared/types'
import type { WebSocketFactory } from '../transport/socket'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, type HelloRequest, isClientControlMessage, type WorkerControlMessage } from './control'
import { type NormalizedWebSocketConfig, normalizeRestoreOptions, normalizeWebSocketOptions, type SharedConnectionConfig } from '../config/normalize'
import { createJsonProtocolAdapter, rawProtocol, validateProtocolAdapter } from '../protocol/adapter'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { isWwsError, toSafePublicError, toWwsError, WwsError } from '../shared/errors'
import { ConnectionController, type ConnectionSink } from '../connection/controller'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'

/** 自定义 Worker runtime 使用的最小 MessagePort 能力面。 */
export interface MessagePortLike {
  /** 发送结构化克隆控制消息。 */
  postMessage: (message: unknown) => void
  /** 开始接收事件。 */
  start?: () => void
  /** 关闭端口并释放其消息通道。 */
  close?: () => void
  /** 注册消息或消息解析错误监听。 */
  addEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** 移除已注册监听。 */
  removeEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** 不支持 addEventListener 时的消息回调。 */
  onmessage?: ((event: { readonly data: unknown }) => void) | null
  /** 不支持 addEventListener 时的消息错误回调。 */
  onmessageerror?: ((event: { readonly data: unknown }) => void) | null
}

/** 自定义 Worker runtime 的依赖、时钟与静态协议注册。 */
export interface SharedWebSocketRuntimeOptions {
  /** 在 Worker 内静态注册的 custom adapter。 */
  readonly protocols?: readonly ProtocolAdapter<unknown, unknown, unknown>[]
  /** 可注入的 WebSocket 工厂。 */
  readonly socketFactory?: WebSocketFactory
  /** 当前时间源，单位为 Unix 毫秒。 */
  readonly now?: () => number
  /** 可注入的 timer 工厂。 */
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  /** 与注入 timer 配对的清理函数。 */
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** runtime 静态资源上限，只能在首个页面连接前设置。 */
  readonly workerLimits?: Partial<WorkerResourceLimits>
}

interface RuntimeClient {
  /** 页面 port 所有权。 */
  readonly port: MessagePortLike
  /** 页面逻辑 client id。 */
  readonly clientId: string
  /** 所属共享连接 id。 */
  readonly connectionId: string
  /** 连接 controller 的事件 sink。 */
  readonly sink: ConnectionSink<unknown>
  /** 最近 lease 报活时间，单位为 Unix 毫秒。 */
  lastLeaseAt: number
  /** 是否暂停实时派发。 */
  suspended: boolean
  /** 挂起期间的有界 replay 队列。 */
  replay: { data: unknown, receivedAt: number, bytes: number }[]
  /** replay 队列当前估算字节数。 */
  replayBytes: number
  /** replay 溢出的消息累计数。 */
  replayDroppedMessages: number
  /** replay 溢出的字节累计数。 */
  replayDroppedBytes: number
  /** 当前页面请求的 restore 边界。 */
  readonly restore: Readonly<NormalizedRestoreOptions>
  /** 下一条 Worker→page delivery 的单调序号。 */
  nextDeliveryId: number
  /** 尚未收到 receipt 的 delivery 与估算字节。 */
  readonly outstandingDeliveries: Map<number, number>
  /** outstanding delivery 当前总字节数。 */
  outstandingBytes: number
  /** credit 满时待通知的入站丢弃数。 */
  inboundDroppedMessages: number
  /** credit 满时待通知的入站丢弃字节。 */
  inboundDroppedBytes: number
}

interface ConnectionEntry {
  /** 共享配置 canonical，用于冲突检测。 */
  readonly canonical: string
  /** Worker 重建物理连接所需配置。 */
  readonly config: NormalizedWebSocketConfig<unknown, unknown, unknown>
  /** 该 id 唯一的物理连接 controller。 */
  readonly controller: ConnectionController<unknown, unknown, unknown>
}

/** SharedWorker 端 runtime：接受页面 port 并拥有共享物理连接。 */
export interface SharedWebSocketRuntime {
  /** Worker 实例 id，仅用于安全诊断关联。 */
  readonly instanceId: string
  /** 接受一个新页面 port；失败时关闭端口。 */
  connect: (port: MessagePortLike) => void
  /** 停止 lease、关闭端口并销毁所有 controller。 */
  dispose: () => void
}

/** 组合 custom adapter 的 Worker 注册 key。 */
function adapterKey(id: string, version: number): string {
  return `${id}@${version}`
}

/** 生成 Worker 实例或测试请求使用的 id。 */
function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 校验正安全整数 Worker 限制。 */
function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new WwsError('INVALID_OPTIONS', `${field} must be a positive safe integer`)
  return value
}

/** 校验正有限 Worker 限制。 */
function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new WwsError('INVALID_OPTIONS', `${field} must be a positive finite number`)
  return value
}

/** 规范化 Worker 级资源限制，限制在 runtime 生命周期内保持不变。 */
function normalizeWorkerLimits(value: Partial<WorkerResourceLimits> | undefined): Readonly<WorkerResourceLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw new WwsError('INVALID_OPTIONS', 'workerLimits must be an options object')
  return Object.freeze({
    maxControlEnvelopeBytes: positiveInteger(value?.maxControlEnvelopeBytes ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxControlEnvelopeBytes, 'workerLimits.maxControlEnvelopeBytes'),
    maxPorts: positiveInteger(value?.maxPorts ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxPorts, 'workerLimits.maxPorts'),
    unattachedPortTimeoutMs: positiveNumber(value?.unattachedPortTimeoutMs ?? DEFAULT_WORKER_RESOURCE_LIMITS.unattachedPortTimeoutMs, 'workerLimits.unattachedPortTimeoutMs'),
  })
}

/** 向有界 replay 队列追加消息，必要时按 oldest-first 丢弃。 */
function pushReplay(client: RuntimeClient, data: unknown, receivedAt: number, maxMessages: number, maxBytes: number): void {
  const bytes = estimateStructuredCloneBytes(data, maxBytes)
  while (client.replay.length >= maxMessages || client.replayBytes + bytes > maxBytes) {
    const removed = client.replay.shift()
    if (removed === undefined)
      break
    client.replayBytes -= removed.bytes
    client.replayDroppedBytes += removed.bytes
    client.replayDroppedMessages++
  }
  if (bytes > maxBytes) {
    client.replayDroppedBytes += bytes
    client.replayDroppedMessages++
    return
  }
  client.replay.push({ bytes, data, receivedAt })
  client.replayBytes += bytes
}

/** Worker→page delivery 的数量上限，防止慢页面无限积压。 */
const MAX_OUTSTANDING_DELIVERIES = 256
/** Worker→page delivery 的字节上限，单位为字节。 */
const MAX_OUTSTANDING_DELIVERY_BYTES = 4 * 1024 * 1024

/** 从共享协议描述解析 Worker 内的 adapter 实现。 */
function resolveAdapter(
  shared: SharedConnectionConfig,
  adapters: ReadonlyMap<string, ProtocolAdapter<unknown, unknown, unknown>>,
): ProtocolAdapter<unknown, unknown, unknown> {
  if (shared.protocol.kind === 'raw')
    return rawProtocol as ProtocolAdapter<unknown, unknown, unknown>
  if (shared.protocol.kind === 'json')
    return createJsonProtocolAdapter(shared.protocol.sharedConfig as never) as ProtocolAdapter<unknown, unknown, unknown>
  const adapter = adapters.get(adapterKey(shared.protocol.id, shared.protocol.version))
  if (adapter === undefined)
    throw new WwsError('ADAPTER_NOT_REGISTERED', 'Custom protocol adapter is not registered in this Worker')
  return adapter
}

/** 根据 hello 重建 Worker 侧规范化配置并校验 canonical/fingerprint。 */
function createWorkerConfig(
  message: HelloRequest,
  adapters: ReadonlyMap<string, ProtocolAdapter<unknown, unknown, unknown>>,
): { readonly config: NormalizedWebSocketConfig<unknown, unknown, unknown>, readonly restore: Readonly<NormalizedRestoreOptions> } {
  const adapter = resolveAdapter(message.shared, adapters)
  const protocol = message.shared.protocol.kind === 'raw'
    ? 'raw'
    : message.shared.protocol.kind === 'json'
      ? message.shared.protocol.sharedConfig as unknown as JsonProtocolOptions
      : adapter
  const normalized = normalizeWebSocketOptions(message.url, {
    autoReconnect: message.shared.reconnect === false ? false : message.shared.reconnect,
    backpressure: message.shared.backpressure,
    binaryType: message.shared.binaryType,
    connectionTimeout: message.shared.connectionTimeout,
    heartbeat: message.shared.heartbeat,
    id: message.id,
    idleGraceMs: message.shared.idleGraceMs,
    lease: message.shared.lease,
    limits: message.shared.limits,
    protocol,
    protocols: message.shared.protocols,
    queue: message.shared.queue,
    worker: () => null as unknown as SharedWorker,
  }) as NormalizedWebSocketConfig<unknown, unknown, unknown>
  if (normalized.configCanonical !== message.configCanonical || normalized.configFingerprint !== message.configFingerprint)
    throw new WwsError('INVALID_CONTROL_MESSAGE', 'Hello configuration does not match its canonical fingerprint')
  return { config: normalized, restore: normalizeRestoreOptions({ restore: message.restore.enabled
    ? { maxBytes: message.restore.maxBytes, maxMessages: message.restore.maxMessages, replay: message.restore.replay }
    : false }) }
}

/** 将任意异常裁剪为可跨端口的稳定 ControlError。 */
function serializeError(error: unknown): ControlError {
  const value = isWwsError(error) ? error : toWwsError(error, 'INTERNAL_STATE_ERROR', 'Worker operation failed')
  const safe = toSafePublicError(value)
  return { code: safe.code, fatal: safe.fatal, retryable: safe.retryable }
}

/**
 * 创建不安装全局 onconnect 的 Worker-side runtime。
 *
 * @param options Worker 内静态 adapter、socket 工厂、时钟和资源上限；创建后资源上限
 * 不能通过页面控制消息放宽。
 * @returns 可手动连接 port、查询 instanceId 并最终 dispose 的 runtime。
 * @throws `WwsError`，当静态 adapter 或 Worker 资源上限无效时。
 */
export function createSharedWebSocketRuntime(options: SharedWebSocketRuntimeOptions = {}): SharedWebSocketRuntime {
  const workerLimits = normalizeWorkerLimits(options.workerLimits)
  const adapters = new Map<string, ProtocolAdapter<unknown, unknown, unknown>>()
  for (const adapter of options.protocols ?? []) {
    validateProtocolAdapter(adapter)
    adapters.set(adapterKey(adapter.id, adapter.version), adapter)
  }
  const connections = new Map<string, ConnectionEntry>()
  const clients = new Map<MessagePortLike, RuntimeClient>()
  const connectedPorts = new Set<MessagePortLike>()
  const unattachedTimers = new Map<MessagePortLike, TimerHandle>()
  const now = options.now ?? Date.now
  const instanceId = createId()
  let leaseTimer: TimerHandle | undefined
  let disposed = false

  /** 将页面 port 从 client、连接 owner 和 Worker 资源集合中释放。 */
  const detach = (port: MessagePortLike, closePort: boolean, releasePort = closePort): void => {
    const client = clients.get(port)
    if (client !== undefined) {
      const entry = connections.get(client.connectionId)
      entry?.controller.detach(client.clientId)
      clients.delete(port)
    }
    if (releasePort) {
      connectedPorts.delete(port)
      const timer = unattachedTimers.get(port)
      if (timer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(timer)
      unattachedTimers.delete(port)
    }
    if (closePort)
      port.close?.()
  }

  /** 只移除仍由指定 controller 拥有且没有 client 的连接项。 */
  const removeIdleConnection = (id: string, controller: ConnectionController<unknown, unknown, unknown>): void => {
    const entry = connections.get(id)
    if (entry?.controller !== controller || controller.attachedClientCount !== 0)
      return
    connections.delete(id)
    controller.dispose()
  }

  /** 周期回收 lease 超时的页面 client。 */
  const scheduleLeaseSweep = (): void => {
    if (disposed)
      return
    leaseTimer = (options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => {
      leaseTimer = undefined
      const current = now()
      for (const [port, client] of clients) {
        const entry = connections.get(client.connectionId)
        if (entry !== undefined && current - client.lastLeaseAt > entry.config.shared.lease.timeout)
          detach(port, true)
      }
      scheduleLeaseSweep()
    }, 1_000)
  }

  /** 向页面安全投递控制消息；端口失败即回收 client。 */
  const post = (port: MessagePortLike, message: WorkerControlMessage): void => {
    try {
      port.postMessage(message)
    }
    catch {
      detach(port, true)
    }
  }

  /** 在 credit 恢复后一次性通知累计入站丢弃。 */
  const flushInboundOverflow = (client: RuntimeClient): void => {
    if (client.inboundDroppedMessages === 0)
      return
    post(client.port, {
      direction: 'inbound',
      droppedBytes: client.inboundDroppedBytes,
      droppedMessages: client.inboundDroppedMessages,
      type: 'overflow',
    })
    client.inboundDroppedBytes = 0
    client.inboundDroppedMessages = 0
  }

  /** 在数量与字节 credit 内投递消息，并登记待回收 delivery。 */
  const deliver = (client: RuntimeClient, data: unknown, receivedAt: number, replayed: boolean): boolean => {
    const bytes = estimateStructuredCloneBytes(data, MAX_OUTSTANDING_DELIVERY_BYTES)
    if (client.outstandingDeliveries.size >= MAX_OUTSTANDING_DELIVERIES
      || client.outstandingBytes + bytes > MAX_OUTSTANDING_DELIVERY_BYTES) {
      if (replayed) {
        client.replayDroppedMessages++
        client.replayDroppedBytes += bytes
      }
      else {
        client.inboundDroppedMessages++
        client.inboundDroppedBytes += bytes
        if (client.outstandingDeliveries.size === 0)
          flushInboundOverflow(client)
      }
      return false
    }
    const deliveryId = ++client.nextDeliveryId
    client.outstandingDeliveries.set(deliveryId, bytes)
    client.outstandingBytes += bytes
    post(client.port, { data, deliveryId, receivedAt, replayed, type: 'message' })
    return true
  }

  /** 回复成功的 request。 */
  const respond = (port: MessagePortLike, requestId: string, value: ControlResponseValue): void => {
    post(port, { ok: true, requestId, type: 'response', value })
  }

  /** 回复已脱敏失败的 request。 */
  const reject = (port: MessagePortLike, requestId: string, error: unknown): void => {
    post(port, { error: serializeError(error), ok: false, requestId, type: 'response' })
  }

  /** 取得已经完成 hello 的 client 和连接项。 */
  const ensureAttached = (port: MessagePortLike): { client: RuntimeClient, entry: ConnectionEntry } => {
    const client = clients.get(port)
    if (client === undefined)
      throw new WwsError('INVALID_CONTROL_MESSAGE', 'Port is not attached')
    const entry = connections.get(client.connectionId)
    if (entry === undefined)
      throw new WwsError('INTERNAL_STATE_ERROR', 'Connection entry is missing')
    return { client, entry }
  }

  /** 创建 controller 到当前页面 port 的事件 sink。 */
  const createSink = (port: MessagePortLike, message: HelloRequest): ConnectionSink<unknown> => ({
    id: message.clientId,
    onClose: event => post(port, { ...event, type: 'close' }),
    onError: error => post(port, { error: serializeError(error), type: 'error' }),
    onMessage: (data, receivedAt) => {
      const client = clients.get(port)
      if (client === undefined)
        return
      if (!client.suspended) {
        deliver(client, data, receivedAt, false)
        return
      }
      const restore = client.restore
      if (!restore.replay)
        return
      pushReplay(client, data, receivedAt, restore.maxMessages, restore.maxBytes)
    },
    onOpen: snapshot => post(port, { snapshot: { ...snapshot, transport: 'shared-worker' }, type: 'open' }),
    onState: (snapshot, reasonCode) => {
      const sharedSnapshot = { ...snapshot, transport: 'shared-worker' as const }
      post(port, reasonCode === undefined
        ? { snapshot: sharedSnapshot, type: 'state' }
        : { reasonCode, snapshot: sharedSnapshot, type: 'state' })
    },
  })

  /** 以 attach→client commit 顺序完成 hello 事务，失败时完整回滚。 */
  const handleHello = (port: MessagePortLike, message: HelloRequest): void => {
    if (message.protocolMajor !== CONTROL_PROTOCOL_MAJOR) {
      reject(port, message.requestId, new WwsError('PROTOCOL_VERSION_MISMATCH', 'Control protocol version mismatch', { fatal: true }))
      detach(port, true)
      return
    }
    let createdEntry: ConnectionEntry | undefined
    try {
      if (!connectedPorts.has(port)) {
        if (connectedPorts.size >= workerLimits.maxPorts) {
          detach(port, true)
          throw new WwsError('RESOURCE_LIMIT_EXCEEDED', 'Maximum Worker ports has been reached')
        }
        connectedPorts.add(port)
      }
      const workerConfig = createWorkerConfig(message, adapters)
      let entry = connections.get(message.id)
      if (entry !== undefined && entry.canonical !== message.configCanonical)
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      if (entry === undefined) {
        const config = workerConfig.config
        const controller = new ConnectionController({
          ...(options.clearTimeout === undefined ? {} : { clearTimeout: options.clearTimeout }),
          config,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.setTimeout === undefined ? {} : { setTimeout: options.setTimeout }),
          ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
          onIdle: idleController => removeIdleConnection(message.id, idleController),
        })
        entry = { canonical: message.configCanonical, config, controller }
        createdEntry = entry
        connections.set(message.id, entry)
      }
      else if (entry.controller.endpointRevision === 0 && entry.config.url !== message.url) {
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Initial endpoint conflicts with the current endpoint')
      }
      detach(port, false, false)
      const sink = createSink(port, message)
      const client: RuntimeClient = {
        clientId: message.clientId,
        connectionId: message.id,
        lastLeaseAt: now(),
        port,
        replay: [],
        replayBytes: 0,
        replayDroppedBytes: 0,
        replayDroppedMessages: 0,
        restore: workerConfig.restore,
        sink,
        suspended: false,
        inboundDroppedBytes: 0,
        inboundDroppedMessages: 0,
        nextDeliveryId: 0,
        outstandingBytes: 0,
        outstandingDeliveries: new Map(),
      }
      entry.controller.attach(sink)
      clients.set(port, client)
      const unattachedTimer = unattachedTimers.get(port)
      if (unattachedTimer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(unattachedTimer)
      unattachedTimers.delete(port)
      respond(port, message.requestId, { attached: true, workerInstanceId: instanceId })
    }
    catch (error) {
      // controller.attach 必须先于 RuntimeClient 提交；如果资源上限拒绝 attach，
      // 临时连接必须同时释放，失败 hello 不能占用 client slot 或留下池中孤儿。
      if (createdEntry !== undefined && createdEntry.controller.attachedClientCount === 0) {
        connections.delete(message.id)
        createdEntry.controller.dispose()
      }
      reject(port, message.requestId, error)
      detach(port, true)
    }
  }

  /** 处理已 hello 端口的请求、lease、挂起、回放和 delivery receipt。 */
  const handleOperation = async (port: MessagePortLike, message: Exclude<ClientControlMessage, HelloRequest>): Promise<void> => {
    if (message.type === 'dispose') {
      detach(port, true)
      return
    }
    if (message.type === 'lease') {
      const client = clients.get(port)
      if (client !== undefined)
        client.lastLeaseAt = now()
      return
    }
    if (message.type === 'suspend') {
      const client = clients.get(port)
      if (client !== undefined)
        client.suspended = true
      return
    }
    if (message.type === 'restore') {
      const client = clients.get(port)
      if (client !== undefined) {
        client.suspended = false
        for (const item of client.replay)
          deliver(client, item.data, item.receivedAt, true)
        client.replay = []
        client.replayBytes = 0
        if (client.replayDroppedMessages > 0) {
          post(port, { direction: 'replay', droppedBytes: client.replayDroppedBytes, droppedMessages: client.replayDroppedMessages, type: 'overflow' })
          client.replayDroppedBytes = 0
          client.replayDroppedMessages = 0
        }
      }
      return
    }
    if (message.type === 'receipt') {
      const client = clients.get(port)
      if (client !== undefined) {
        const bytes = client.outstandingDeliveries.get(message.deliveryId)
        if (bytes !== undefined) {
          client.outstandingDeliveries.delete(message.deliveryId)
          client.outstandingBytes -= bytes
          flushInboundOverflow(client)
        }
      }
      return
    }
    try {
      const { client, entry } = ensureAttached(port)
      switch (message.type) {
        case 'open':
          entry.controller.attach(client.sink)
          respond(port, message.requestId, { ...await entry.controller.open(), transport: 'shared-worker' })
          break
        case 'close':
          detach(port, false, true)
          respond(port, message.requestId, null)
          break
        case 'send':
          respond(port, message.requestId, await entry.controller.send(client.clientId, message.data, message.options))
          break
        case 'update-auth':
          respond(port, message.requestId, await entry.controller.updateAuth(message.auth, message.revision))
          break
        case 'clear-auth':
          respond(port, message.requestId, await entry.controller.clearAuth(message.revision))
          break
        case 'update-url':
          respond(port, message.requestId, await entry.controller.updateUrl(message.url, message.revision))
          break
        case 'reconnect':
          await entry.controller.reconnect(message.reason)
          respond(port, message.requestId, null)
          break
        case 'diagnostics':
          respond(port, message.requestId, entry.controller.diagnostics('shared-worker', stableHash(instanceId)))
          break
        case 'probe':
          respond(port, message.requestId, { attached: true, workerInstanceId: instanceId })
          break
      }
    }
    catch (error) {
      reject(port, message.requestId, error)
    }
  }

  /** 接受一个新端口，安装严格 parser，并设置未 hello 回收 timer。 */
  const connect = (port: MessagePortLike): void => {
    if (disposed) {
      port.close?.()
      return
    }
    if (connectedPorts.size >= workerLimits.maxPorts) {
      port.close?.()
      return
    }
    connectedPorts.add(port)
    const onMessage = (event: { readonly data: unknown }): void => {
      if (estimateStructuredCloneBytes(event.data, workerLimits.maxControlEnvelopeBytes) > workerLimits.maxControlEnvelopeBytes) {
        detach(port, true)
        return
      }
      if (!isClientControlMessage(event.data)) {
        const record = event.data as { readonly requestId?: unknown }
        if (typeof record?.requestId === 'string')
          reject(port, record.requestId, new WwsError('INVALID_CONTROL_MESSAGE', 'Invalid control message'))
        else
          detach(port, true)
        return
      }
      if (event.data.type === 'hello')
        handleHello(port, event.data)
      else
        void handleOperation(port, event.data)
    }
    const onMessageError = (): void => detach(port, true)
    if (port.addEventListener !== undefined) {
      port.addEventListener('message', onMessage)
      port.addEventListener('messageerror', onMessageError)
    }
    else {
      port.onmessage = onMessage
      port.onmessageerror = onMessageError
    }
    port.start?.()
    const timer = (options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => detach(port, true), workerLimits.unattachedPortTimeoutMs)
    unattachedTimers.set(port, timer)
  }

  scheduleLeaseSweep()

  return {
    connect,
    /** 幂等销毁 runtime 拥有的所有 timer、端口与物理连接。 */
    dispose(): void {
      if (disposed)
        return
      disposed = true
      if (leaseTimer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(leaseTimer)
      for (const port of [...clients.keys()])
        detach(port, true)
      for (const port of [...connectedPorts])
        detach(port, true)
      for (const entry of connections.values())
        entry.controller.dispose()
      connections.clear()
    },
    instanceId,
  }
}

/** `exposeSharedWebSocketWorker` 接受的最小 SharedWorker global scope。 */
export interface SharedWorkerGlobalLike {
  /** 当前 Worker 的连接入口。 */
  onconnect: ((event: { readonly ports: readonly MessagePortLike[] }) => void) | null
}

/**
 * 创建 runtime 并在 SharedWorker global scope 安装 onconnect。
 *
 * @param options Worker runtime 依赖和静态资源上限。
 * @param scope 可选的测试/自定义 global scope；省略时使用当前 Worker globalThis。
 * @returns 已安装连接入口的 runtime。
 * @throws `WwsError`，当 runtime 选项无效时。
 */
export function exposeSharedWebSocketWorker(options: SharedWebSocketRuntimeOptions = {}, scope?: SharedWorkerGlobalLike): SharedWebSocketRuntime {
  const target = scope ?? globalThis as unknown as SharedWorkerGlobalLike
  const runtime = createSharedWebSocketRuntime(options)
  target.onconnect = (event): void => {
    const port = event.ports[0]
    if (port !== undefined)
      runtime.connect(port)
  }
  return runtime
}
