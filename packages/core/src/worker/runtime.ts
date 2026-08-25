import type { JsonProtocolOptions, NormalizedRestoreOptions, ProtocolAdapter, TimerHandle, WorkerResourceLimits } from '../shared/types'
import type { WebSocketFactory } from '../transport/socket'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, type HelloRequest, isClientControlMessage, type WorkerControlMessage } from './control'
import { type NormalizedWebSocketConfig, normalizeRestoreOptions, normalizeWebSocketOptions, type SharedConnectionConfig } from '../config/normalize'
import { createJsonProtocolAdapter, rawProtocol, validateProtocolAdapter } from '../protocol/adapter'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { isWwsError, toSafePublicError, toWwsError, WwsError } from '../shared/errors'
import { ConnectionController, type ConnectionSink } from '../connection/controller'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'

/** Minimal MessagePort surface used by the custom Worker runtime. */
export interface MessagePortLike {
  postMessage: (message: unknown) => void
  start?: () => void
  close?: () => void
  addEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  removeEventListener?: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  onmessage?: ((event: { readonly data: unknown }) => void) | null
  onmessageerror?: ((event: { readonly data: unknown }) => void) | null
}

/** Custom Worker runtime dependencies and statically registered protocols. */
export interface SharedWebSocketRuntimeOptions {
  readonly protocols?: readonly ProtocolAdapter<unknown, unknown, unknown>[]
  readonly socketFactory?: WebSocketFactory
  readonly now?: () => number
  readonly setTimeout?: (callback: () => void, delay: number) => TimerHandle
  readonly clearTimeout?: (handle: TimerHandle) => void
  /** Static limits for this Worker runtime, set once before any page connects. */
  readonly workerLimits?: Partial<WorkerResourceLimits>
}

interface RuntimeClient {
  readonly port: MessagePortLike
  readonly clientId: string
  readonly connectionId: string
  readonly sink: ConnectionSink<unknown>
  lastLeaseAt: number
  suspended: boolean
  replay: { data: unknown, receivedAt: number, bytes: number }[]
  replayBytes: number
  replayDroppedMessages: number
  replayDroppedBytes: number
  readonly restore: Readonly<NormalizedRestoreOptions>
  nextDeliveryId: number
  readonly outstandingDeliveries: Map<number, number>
  outstandingBytes: number
  inboundDroppedMessages: number
  inboundDroppedBytes: number
}

interface ConnectionEntry {
  readonly canonical: string
  readonly config: NormalizedWebSocketConfig<unknown, unknown, unknown>
  readonly controller: ConnectionController<unknown, unknown, unknown>
}

/** SharedWorker-side runtime that accepts page ports and owns connections. */
export interface SharedWebSocketRuntime {
  readonly instanceId: string
  connect: (port: MessagePortLike) => void
  dispose: () => void
}

function adapterKey(id: string, version: number): string {
  return `${id}@${version}`
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `worker-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new WwsError('INVALID_OPTIONS', `${field} must be a positive safe integer`)
  return value
}

function positiveNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
    throw new WwsError('INVALID_OPTIONS', `${field} must be a positive finite number`)
  return value
}

function normalizeWorkerLimits(value: Partial<WorkerResourceLimits> | undefined): Readonly<WorkerResourceLimits> {
  if (value !== undefined && (value === null || typeof value !== 'object'))
    throw new WwsError('INVALID_OPTIONS', 'workerLimits must be an options object')
  return Object.freeze({
    maxControlEnvelopeBytes: positiveInteger(value?.maxControlEnvelopeBytes ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxControlEnvelopeBytes, 'workerLimits.maxControlEnvelopeBytes'),
    maxPorts: positiveInteger(value?.maxPorts ?? DEFAULT_WORKER_RESOURCE_LIMITS.maxPorts, 'workerLimits.maxPorts'),
    unattachedPortTimeoutMs: positiveNumber(value?.unattachedPortTimeoutMs ?? DEFAULT_WORKER_RESOURCE_LIMITS.unattachedPortTimeoutMs, 'workerLimits.unattachedPortTimeoutMs'),
  })
}

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

const MAX_OUTSTANDING_DELIVERIES = 256
const MAX_OUTSTANDING_DELIVERY_BYTES = 4 * 1024 * 1024

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

function serializeError(error: unknown): ControlError {
  const value = isWwsError(error) ? error : toWwsError(error, 'INTERNAL_STATE_ERROR', 'Worker operation failed')
  const safe = toSafePublicError(value)
  return { code: safe.code, fatal: safe.fatal, retryable: safe.retryable }
}

/** Create a Worker-side runtime without installing a global `onconnect` hook. */
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

  const removeIdleConnection = (id: string, controller: ConnectionController<unknown, unknown, unknown>): void => {
    const entry = connections.get(id)
    if (entry?.controller !== controller || controller.attachedClientCount !== 0)
      return
    connections.delete(id)
    controller.dispose()
  }

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

  const post = (port: MessagePortLike, message: WorkerControlMessage): void => {
    try {
      port.postMessage(message)
    }
    catch {
      detach(port, true)
    }
  }

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

  const respond = (port: MessagePortLike, requestId: string, value: ControlResponseValue): void => {
    post(port, { ok: true, requestId, type: 'response', value })
  }

  const reject = (port: MessagePortLike, requestId: string, error: unknown): void => {
    post(port, { error: serializeError(error), ok: false, requestId, type: 'response' })
  }

  const ensureAttached = (port: MessagePortLike): { client: RuntimeClient, entry: ConnectionEntry } => {
    const client = clients.get(port)
    if (client === undefined)
      throw new WwsError('INVALID_CONTROL_MESSAGE', 'Port is not attached')
    const entry = connections.get(client.connectionId)
    if (entry === undefined)
      throw new WwsError('INTERNAL_STATE_ERROR', 'Connection entry is missing')
    return { client, entry }
  }

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
      // Attach is intentionally performed before committing the RuntimeClient.
      // If it rejects (for example, because maxClientsPerConnection is full),
      // release the provisional connection entry so this failed hello cannot
      // consume a client slot or leave a stale controller in the Worker pool.
      if (createdEntry !== undefined && createdEntry.controller.attachedClientCount === 0) {
        connections.delete(message.id)
        createdEntry.controller.dispose()
      }
      reject(port, message.requestId, error)
      detach(port, true)
    }
  }

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

/** Minimal SharedWorker global scope accepted by `exposeSharedWebSocketWorker`. */
export interface SharedWorkerGlobalLike {
  onconnect: ((event: { readonly ports: readonly MessagePortLike[] }) => void) | null
}

/** Create a runtime and install its port handler on the SharedWorker global scope. */
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
