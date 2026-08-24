import type { NormalizedRestoreOptions, ProtocolAdapter, TimerHandle } from './types'
import type { NormalizedWebSocketConfig, SharedConnectionConfig } from './config'
import type { WebSocketFactory } from './socket'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, type HelloRequest, isClientControlMessage, type WorkerControlMessage } from './control'
import { createJsonProtocolAdapter, rawProtocol, validateProtocolAdapter } from './protocol'
import { ConnectionController, type ConnectionSink } from './connection-controller'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_RESOURCE_LIMITS } from './constants'
import { isWwsError, toWwsError, WwsError } from './errors'
import { stableHash } from './structured'

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

function estimateBytes(value: unknown): number {
  if (typeof value === 'string')
    return new TextEncoder().encode(value).byteLength
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return value.size
  if (value instanceof ArrayBuffer)
    return value.byteLength
  if (ArrayBuffer.isView(value))
    return value.byteLength
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  }
  catch {
    return 0
  }
}

function pushReplay(client: RuntimeClient, data: unknown, receivedAt: number, maxMessages: number, maxBytes: number): void {
  const bytes = estimateBytes(data)
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
): NormalizedWebSocketConfig<unknown, unknown, unknown> {
  const adapter = resolveAdapter(message.shared, adapters)
  return Object.freeze({
    adapter,
    configCanonical: message.configCanonical,
    configFingerprint: message.configFingerprint,
    id: message.id,
    local: Object.freeze({
      autoClose: true,
      fallback: 'error' as const,
      immediate: true,
      lifecycle: Object.freeze({ enabled: false, maxBytes: 0, maxMessages: 0, replay: false }),
      logger: undefined,
      workerMode: 'custom' as const,
    }),
    shared: message.shared,
    url: message.url,
  })
}

function serializeError(error: unknown): ControlError {
  const value = isWwsError(error) ? error : toWwsError(error, 'INTERNAL_STATE_ERROR', 'Worker operation failed')
  return { code: value.code, fatal: value.fatal, message: value.message, retryable: value.retryable }
}

/** Create a Worker-side runtime without installing a global `onconnect` hook. */
export function createSharedWebSocketRuntime(options: SharedWebSocketRuntimeOptions = {}): SharedWebSocketRuntime {
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

  const detach = (port: MessagePortLike, closePort: boolean): void => {
    const client = clients.get(port)
    if (client === undefined)
      return
    const entry = connections.get(client.connectionId)
    entry?.controller.detach(client.clientId)
    clients.delete(port)
    if (closePort) {
      connectedPorts.delete(port)
      const timer = unattachedTimers.get(port)
      if (timer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(timer)
      unattachedTimers.delete(port)
      port.close?.()
    }
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
        post(port, { data, receivedAt, replayed: false, type: 'message' })
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
      return
    }
    try {
      let entry = connections.get(message.id)
      if (entry !== undefined && entry.canonical !== message.configCanonical)
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Connection id already uses a different shared configuration')
      if (entry === undefined) {
        const config = createWorkerConfig(message, adapters)
        const controller = new ConnectionController({
          ...(options.clearTimeout === undefined ? {} : { clearTimeout: options.clearTimeout }),
          config,
          ...(options.now === undefined ? {} : { now: options.now }),
          ...(options.setTimeout === undefined ? {} : { setTimeout: options.setTimeout }),
          ...(options.socketFactory === undefined ? {} : { socketFactory: options.socketFactory }),
        })
        entry = { canonical: message.configCanonical, config, controller }
        connections.set(message.id, entry)
      }
      else if (entry.controller.endpointRevision === 0 && entry.config.url !== message.url) {
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Initial endpoint conflicts with the current endpoint')
      }
      detach(port, false)
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
        restore: message.restore,
        sink,
        suspended: false,
      }
      clients.set(port, client)
      const unattachedTimer = unattachedTimers.get(port)
      if (unattachedTimer !== undefined)
        (options.clearTimeout ?? globalThis.clearTimeout)(unattachedTimer)
      unattachedTimers.delete(port)
      entry.controller.attach(sink)
      respond(port, message.requestId, { attached: true, workerInstanceId: instanceId })
    }
    catch (error) {
      reject(port, message.requestId, error)
    }
  }

  const handleOperation = async (port: MessagePortLike, message: Exclude<ClientControlMessage, HelloRequest>): Promise<void> => {
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
        if (client.replayDroppedMessages > 0) {
          post(port, { direction: 'replay', droppedBytes: client.replayDroppedBytes, droppedMessages: client.replayDroppedMessages, type: 'overflow' })
          client.replayDroppedBytes = 0
          client.replayDroppedMessages = 0
        }
        for (const item of client.replay)
          post(port, { data: item.data, receivedAt: item.receivedAt, replayed: true, type: 'message' })
        client.replay = []
        client.replayBytes = 0
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
          entry.controller.detach(client.clientId)
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
        case 'dispose':
          detach(port, true)
          respond(port, message.requestId, null)
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
    if (connectedPorts.size >= DEFAULT_RESOURCE_LIMITS.maxPortsPerWorker) {
      port.close?.()
      return
    }
    connectedPorts.add(port)
    const onMessage = (event: { readonly data: unknown }): void => {
      const client = clients.get(port)
      const maxBytes = client === undefined
        ? DEFAULT_RESOURCE_LIMITS.maxControlEnvelopeBytes
        : connections.get(client.connectionId)?.config.shared.limits.maxControlEnvelopeBytes ?? DEFAULT_RESOURCE_LIMITS.maxControlEnvelopeBytes
      if (estimateBytes(event.data) > maxBytes) {
        detach(port, true)
        return
      }
      if (!isClientControlMessage(event.data)) {
        const record = event.data as { readonly requestId?: unknown }
        if (typeof record?.requestId === 'string')
          reject(port, record.requestId, new WwsError('INVALID_CONTROL_MESSAGE', 'Invalid control message'))
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
    const timer = (options.setTimeout ?? ((callback, delay) => globalThis.setTimeout(callback, delay)))(() => detach(port, true), DEFAULT_RESOURCE_LIMITS.unattachedPortTimeoutMs)
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
