import type {
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  TimerHandle,
} from './types'
import type { ConnectionSink } from './connection-controller'
import type { NormalizedWebSocketConfig } from './config'
import type { ClientTransport } from './direct-transport'
import type { MessagePortLike } from './worker-runtime'
import { type ClientControlMessage, type ControlError, type ControlResponseValue, isWorkerControlMessage } from './control'
import { createSafePublicError, WwsError } from './errors'
import { CONTROL_PROTOCOL_MAJOR } from './constants'

export interface SharedWorkerLike {
  readonly port: MessagePortLike
}

export interface SharedWorkerTransportOptions<Incoming, Outgoing, Auth> {
  readonly worker: SharedWorkerLike
  readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>
  readonly clientId: string
  readonly mode: 'inline' | 'custom'
  /** Lazily construct direct fallback only after an allowlisted init failure. */
  readonly createFallback?: () => ClientTransport<Incoming, Outgoing, Auth>
  readonly initTimeout?: number
}

interface PendingRequest {
  readonly resolve: (value: ControlResponseValue) => void
  readonly reject: (error: WwsError) => void
  readonly timer: TimerHandle
}

function canFallbackFromWorkerError(error: unknown, workerInstanceId: string | null): boolean {
  if (workerInstanceId !== null)
    return false
  if (!(error instanceof WwsError))
    return true
  return [
    'ADAPTER_NOT_REGISTERED',
    'PROTOCOL_VERSION_MISMATCH',
    'WORKER_CONSTRUCTION_FAILED',
    'WORKER_DISCONNECTED',
    'WORKER_INIT_TIMEOUT',
    'WORKER_LOAD_FAILED',
    'WORKER_UNSUPPORTED',
  ].includes(error.code)
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID()
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function deserializeError(value: ControlError): WwsError {
  return createSafePublicError(value.code, { fatal: value.fatal, retryable: value.retryable })
}

function toInitError(error: unknown): WwsError {
  if (error instanceof WwsError)
    return error
  return new WwsError('WORKER_LOAD_FAILED', 'SharedWorker initialization failed', { cause: error })
}

function emptyDiagnostics<Incoming, Outgoing, Auth>(
  config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>,
  workerInstanceId: string | null,
): Readonly<ConnectionDiagnostics> {
  return Object.freeze({
    attachedClientCount: 0,
    bufferedAmount: 0,
    configFingerprint: config.configFingerprint,
    controlProtocolMajor: CONTROL_PROTOCOL_MAJOR,
    endpointOrigin: new URL(config.url).origin,
    idHash: '',
    lastErrorCode: null,
    lastSafeCloseCode: null,
    logicalState: 'idle',
    nextRetryDelay: null,
    outboundHighWater: false,
    physicalState: 'idle',
    queueBytes: 0,
    queueMessages: 0,
    retryAttempt: 0,
    transport: 'shared-worker',
    workerInstanceHash: workerInstanceId,
  })
}

export class SharedWorkerTransport<Incoming, Outgoing, Auth = unknown> implements ClientTransport<Incoming, Outgoing, Auth> {
  private readonly port: MessagePortLike
  private readonly requests = new Map<string, PendingRequest>()
  private sink: ConnectionSink<Incoming> | undefined
  private helloPromise: Promise<void> | undefined
  private fallbackActive = false
  private disposed = false
  private workerInstanceId: string | null = null
  private leaseTimer: TimerHandle | undefined
  private diagnosticsSnapshot: Readonly<ConnectionDiagnostics> | undefined
  private fallback: ClientTransport<Incoming, Outgoing, Auth> | undefined

  constructor(readonly options: SharedWorkerTransportOptions<Incoming, Outgoing, Auth>) {
    this.port = options.worker.port
    const onMessage = (event: { readonly data: unknown }): void => this.handleMessage(event.data)
    const onMessageError = (): void => this.handleDisconnect(new WwsError('WORKER_DISCONNECTED', 'SharedWorker port reported a message error', { retryable: true }))
    if (this.port.addEventListener !== undefined) {
      this.port.addEventListener('message', onMessage)
      this.port.addEventListener('messageerror', onMessageError)
    }
    else {
      this.port.onmessage = onMessage
      this.port.onmessageerror = onMessageError
    }
    this.port.start?.()
  }

  get kind(): 'direct' | 'shared-worker' {
    return this.fallbackActive ? 'direct' : 'shared-worker'
  }

  get workerMode(): 'none' | 'inline' | 'custom' {
    return this.fallbackActive ? 'none' : this.options.mode
  }

  get capabilities(): ProtocolCapabilities {
    return this.fallbackActive && this.fallback !== undefined
      ? this.fallback.capabilities
      : this.options.config.adapter.capabilities
  }

  attach(sink: ConnectionSink<Incoming>): void {
    this.sink = sink
    if (this.fallbackActive) {
      this.fallback?.attach(sink)
      return
    }
    void this.ensureHello().catch((error) => {
      if (this.options.createFallback !== undefined)
        void this.activateFallback(error).catch(value => this.sink?.onError?.(toInitError(value)))
      else
        this.sink?.onError?.(toInitError(error))
    })
  }

  async open(signal?: AbortSignal): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (signal?.aborted)
      throw new WwsError('ABORTED', 'Open wait was aborted')
    try {
      await this.ensureHello()
    }
    catch (error) {
      await this.activateFallback(error)
    }
    if (this.fallbackActive) {
      if (this.sink !== undefined)
        this.fallback?.attach(this.sink)
      if (this.fallback === undefined)
        throw toInitError(new WwsError('WORKER_DISCONNECTED', 'SharedWorker initialization failed'))
      return this.fallback.open(signal)
    }
    return await this.request({ requestId: createId(), type: 'open' }) as ConnectionSnapshot
  }

  close(): void {
    if (this.fallbackActive) {
      this.fallback?.close()
      return
    }
    if (this.helloPromise !== undefined) {
      void this.request({ requestId: createId(), type: 'close' }).catch(() => undefined)
      // A following open must issue a fresh hello even when it races the
      // best-effort close request. MessagePort ordering keeps close before
      // that new hello in the Worker.
      this.resetHello()
    }
  }

  async send(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().send(data, options)
    const requestId = createId()
    const message: ClientControlMessage = options === undefined
      ? { data, requestId, type: 'send' }
      : { data, options, requestId, type: 'send' }
    return await this.request(message) as SendReceipt
  }

  async updateAuth(value: Auth, revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().updateAuth(value, revision)
    return await this.request({ auth: value, requestId: createId(), revision, type: 'update-auth' }) as RevisionReceipt
  }

  async clearAuth(revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().clearAuth(revision)
    return await this.request({ requestId: createId(), revision, type: 'clear-auth' }) as RevisionReceipt
  }

  async updateUrl(url: string, revision: number): Promise<RevisionReceipt> {
    await this.ensureReady()
    if (this.fallbackActive)
      return this.requireFallback().updateUrl(url, revision)
    return await this.request({ requestId: createId(), revision, type: 'update-url', url }) as RevisionReceipt
  }

  async reconnect(reason?: string): Promise<void> {
    await this.ensureReady()
    if (this.fallbackActive) {
      await this.requireFallback().reconnect(reason)
      return
    }
    const message: ClientControlMessage = reason === undefined
      ? { requestId: createId(), type: 'reconnect' }
      : { reason, requestId: createId(), type: 'reconnect' }
    await this.request(message)
  }

  async probe(): Promise<string> {
    this.assertUsable()
    await this.ensureHello()
    if (this.fallbackActive)
      throw new WwsError('WORKER_DISCONNECTED', 'SharedWorker transport is no longer selected')
    const value = await this.request({ requestId: createId(), type: 'probe' }, 1_000)
    if (value === null || typeof value !== 'object' || !('workerInstanceId' in value) || typeof value.workerInstanceId !== 'string')
      throw new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker probe returned an invalid response')
    if (this.workerInstanceId !== null && this.workerInstanceId !== value.workerInstanceId)
      throw new WwsError('WORKER_DISCONNECTED', 'SharedWorker instance changed', { retryable: true })
    return value.workerInstanceId
  }

  suspend(): void {
    if (this.fallbackActive) {
      this.fallback?.suspend?.()
      return
    }
    this.post({ type: 'suspend' })
  }

  restore(): void {
    if (this.fallbackActive) {
      this.fallback?.restore?.()
      return
    }
    this.post({ type: 'restore' })
  }

  detach(clientId: string): void {
    if (this.fallbackActive) {
      this.fallback?.detach(clientId)
      return
    }
    this.close()
  }

  diagnostics(): Readonly<Record<string, unknown>> {
    if (this.fallbackActive)
      return this.fallback?.diagnostics() ?? {}
    if (this.helloPromise !== undefined)
      void this.request({ requestId: createId(), type: 'diagnostics' }).then(value => this.setDiagnostics(value)).catch(() => undefined)
    return this.diagnosticsSnapshot ?? emptyDiagnostics(this.options.config, this.workerInstanceId)
  }

  dispose(): void {
    if (this.disposed)
      return
    if (this.fallbackActive) {
      this.disposed = true
      this.fallback?.dispose()
      return
    }
    if (this.leaseTimer !== undefined)
      globalThis.clearInterval(this.leaseTimer)
    this.leaseTimer = undefined
    // This also releases a newly-created but never-attached port without
    // waiting for the Worker's unattached-port timeout.
    try {
      this.port.postMessage({ requestId: createId(), type: 'dispose' })
    }
    catch {
      // A failed port still gets closed below.
    }
    this.port.close?.()
    this.rejectAll(new WwsError('CLIENT_DISPOSED', 'SharedWorker transport was disposed'))
    this.disposed = true
    this.fallback?.dispose()
  }

  private ensureHello(): Promise<void> {
    this.assertUsable()
    if (this.fallbackActive)
      return Promise.resolve()
    if (this.helloPromise !== undefined)
      return this.helloPromise
    const requestId = createId()
    this.helloPromise = this.request({
      clientId: this.options.clientId,
      configCanonical: this.options.config.configCanonical,
      configFingerprint: this.options.config.configFingerprint,
      id: this.options.config.id,
      protocolMajor: CONTROL_PROTOCOL_MAJOR,
      requestId,
      restore: this.options.config.local.lifecycle,
      shared: this.options.config.shared,
      type: 'hello',
      url: this.options.config.url,
    }, this.options.initTimeout ?? 5_000).then((value) => {
      if (value === null || typeof value !== 'object' || !('workerInstanceId' in value))
        throw new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker returned an invalid welcome response')
      this.workerInstanceId = String(value.workerInstanceId)
      this.leaseTimer = globalThis.setInterval(() => this.post({ type: 'lease' }), this.options.config.shared.lease.interval)
    })
    return this.helloPromise
  }

  private resetHello(): void {
    if (this.leaseTimer !== undefined)
      globalThis.clearInterval(this.leaseTimer)
    this.leaseTimer = undefined
    this.helloPromise = undefined
    this.workerInstanceId = null
  }

  private async ensureReady(): Promise<void> {
    try {
      await this.ensureHello()
    }
    catch (error) {
      await this.activateFallback(error)
    }
  }

  private request(message: ClientControlMessage, timeout = 10_000): Promise<ControlResponseValue> {
    if (!('requestId' in message))
      return Promise.reject(new WwsError('INVALID_CONTROL_MESSAGE', 'Control request is missing requestId'))
    const promise = new Promise<ControlResponseValue>((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.requests.delete(message.requestId)
        reject(new WwsError(message.type === 'hello' ? 'WORKER_INIT_TIMEOUT' : 'WORKER_DISCONNECTED', 'SharedWorker request timed out', { retryable: true }))
      }, timeout)
      this.requests.set(message.requestId, { reject, resolve, timer })
    })
    this.post(message)
    return promise
  }

  private post(message: ClientControlMessage): void {
    try {
      this.port.postMessage(message)
    }
    catch (cause) {
      this.handleDisconnect(new WwsError('WORKER_DISCONNECTED', 'Unable to post to SharedWorker', { cause, retryable: true }))
    }
  }

  private handleMessage(value: unknown): void {
    if (!isWorkerControlMessage(value)) {
      this.handleDisconnect(new WwsError('INVALID_CONTROL_MESSAGE', 'SharedWorker sent an invalid control message'))
      return
    }
    if (value.type === 'response') {
      const request = this.requests.get(value.requestId)
      if (request === undefined)
        return
      globalThis.clearTimeout(request.timer)
      this.requests.delete(value.requestId)
      if (value.ok)
        request.resolve(value.value)
      else
        request.reject(deserializeError(value.error))
      return
    }
    if (value.type === 'state')
      this.sink?.onState?.(value.snapshot, value.reasonCode)
    else if (value.type === 'open')
      this.sink?.onOpen?.(value.snapshot)
    else if (value.type === 'message')
      this.post({ deliveryId: value.deliveryId, type: 'receipt' })
    if (value.type === 'message')
      this.sink?.onMessage?.(value.data as Incoming, value.receivedAt, value.replayed)
    else if (value.type === 'close')
      this.sink?.onClose?.(value)
    else if (value.type === 'error')
      this.sink?.onError?.(deserializeError(value.error))
    else if (value.type === 'overflow')
      this.sink?.onOverflow?.({
        direction: value.direction,
        droppedBytes: value.droppedBytes,
        droppedMessages: value.droppedMessages,
        strategy: value.direction === 'replay' ? 'drop-oldest' : 'drop-newest',
      })
  }

  private setDiagnostics(value: ControlResponseValue): void {
    if (value === null || typeof value !== 'object' || !('logicalState' in value))
      return
    this.diagnosticsSnapshot = value as ConnectionDiagnostics
  }

  private handleDisconnect(error: WwsError): void {
    this.rejectAll(error)
    this.sink?.onError?.(error)
  }

  private rejectAll(error: WwsError): void {
    for (const request of this.requests.values()) {
      globalThis.clearTimeout(request.timer)
      request.reject(error)
    }
    this.requests.clear()
  }

  private async activateFallback(error: unknown): Promise<void> {
    if (this.fallbackActive)
      return
    if (!canFallbackFromWorkerError(error, this.workerInstanceId))
      throw error
    if (this.options.createFallback === undefined)
      throw toInitError(error)
    this.fallback = this.options.createFallback()
    this.fallbackActive = true
    this.rejectAll(toInitError(error))
    this.port.close?.()
    if (this.sink !== undefined)
      this.fallback.attach(this.sink)
  }

  private requireFallback(): ClientTransport<Incoming, Outgoing, Auth> {
    if (this.fallback === undefined)
      throw new WwsError('WORKER_DISCONNECTED', 'Direct fallback is not configured')
    return this.fallback
  }

  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'SharedWorker transport has been disposed')
  }
}
