import type {
  ConnectionDiagnostics,
  ConnectionSnapshot,
  ConnectionState,
  CreateWebSocketOptions,
  NormalizedRestoreOptions,
  ProtocolCapabilities,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
  WwsCloseEvent,
  WwsDiagnosticEvent,
  WwsMessageEvent,
  WwsOverflowEvent,
  WwsStateChangeEvent,
} from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import type { ConnectionSink } from '../connection/controller'
import type { ClientTransport } from '../transport/direct'
import { estimateStructuredCloneBytes, stableHash } from '../shared/structured'
import { toSafePublicError, toWwsError, WwsError } from '../shared/errors'
import { readyStateFor, statusFor } from '../connection/state'

type MessageHandler<Incoming> = (event: WwsMessageEvent<Incoming>) => void

const EventTargetBase: typeof EventTarget = typeof EventTarget === 'undefined'
  ? class { addEventListener(): void {} removeEventListener(): void {} dispatchEvent(): boolean { return false } } as unknown as typeof EventTarget
  : EventTarget

function sanitizeDetails(details: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> | undefined {
  if (details === undefined)
    return undefined
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
      safe[key] = value
  }
  return safe
}

function sanitizeError(error: WwsError): WwsError {
  const details = sanitizeDetails(error.details)
  return toSafePublicError(new WwsError(error.code, error.message, details === undefined
    ? { fatal: error.fatal, retryable: error.retryable }
    : { details, fatal: error.fatal, retryable: error.retryable }))
}

function createMessageEvent<Incoming>(data: Incoming, receivedAt: number, transport: Exclude<Transport, 'pending'>, replayed: boolean): WwsMessageEvent<Incoming> {
  const event = new Event('message') as WwsMessageEvent<Incoming>
  Object.defineProperties(event, {
    data: { value: data },
    receivedAt: { value: receivedAt },
    replayed: { value: replayed },
    transport: { value: transport },
  })
  return event
}

function createCloseEvent(event: { readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }): WwsCloseEvent {
  const result = new Event('close') as WwsCloseEvent
  Object.defineProperties(result, {
    code: { value: event.code },
    terminal: { value: event.terminal },
    wasClean: { value: event.wasClean },
    willReconnect: { value: event.willReconnect },
  })
  return result
}

function createErrorEvent(error: WwsError): Event {
  const event = new Event('error')
  Object.defineProperty(event, 'error', { value: error })
  Object.defineProperty(event, 'detail', { value: error })
  return event
}

function estimateValueBytes(value: unknown): number {
  return estimateStructuredCloneBytes(value)
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function stateValue(value: unknown, fallback: ConnectionState): ConnectionState {
  return typeof value === 'string' ? value as ConnectionState : fallback
}

export class PageWebSocketClient<Incoming, Outgoing, Auth> extends EventTargetBase implements WebSocketClient<Incoming, Outgoing, Auth> {
  private currentData: Incoming | null = null
  private currentState: ConnectionState = 'idle'
  private currentTransport: Transport
  private currentWorkerMode: WorkerMode
  private disposed = false
  private attached = false
  private suspended = false
  private readonly handlers = new Map<symbol, MessageHandler<Incoming>>()
  private readonly restore: Readonly<NormalizedRestoreOptions>
  private readonly replay: { data: Incoming, receivedAt: number, bytes: number }[] = []
  private replayBytes = 0
  private overflowCount = 0
  private lifecycleCleanups: (() => void)[] = []
  private latestEndpoint: { revision: number, url: string } | undefined
  private latestAuth: { revision: number, value: Auth | undefined } | undefined
  private hadDemand = false
  private recovery: Promise<void> | undefined

  constructor(
    readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>,
    private clientTransport: ClientTransport<Incoming, Outgoing, Auth>,
    readonly options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
    readonly clientId: string,
    private readonly recreateSharedTransport?: () => ClientTransport<Incoming, Outgoing, Auth>,
  ) {
    super()
    this.currentTransport = clientTransport.kind
    this.currentWorkerMode = clientTransport.workerMode
    this.restore = config.local.lifecycle
    if (options.onMessage !== undefined)
      this.onMessage(event => options.onMessage?.(this, event))
    this.installLifecycle()
  }

  get data(): Incoming | null {
    return this.currentData
  }

  get status(): WebSocketStatus {
    return statusFor(this.currentState)
  }

  get state(): ConnectionState {
    return this.currentState
  }

  get readyState(): 0 | 1 | 2 | 3 {
    return readyStateFor(this.currentState)
  }

  get transport(): Transport {
    return this.currentTransport
  }

  get workerMode(): WorkerMode {
    return this.currentWorkerMode
  }

  get capabilities(): ProtocolCapabilities {
    return this.clientTransport.capabilities
  }

  async open(options?: { signal?: AbortSignal }): Promise<ConnectionSnapshot> {
    this.assertUsable()
    if (!this.attached) {
      this.clientTransport.attach(this.createSink())
      this.attached = true
    }
    const snapshot = await this.sanitizePublicPromise(this.clientTransport.open(options?.signal))
    this.hadDemand = true
    if (snapshot.state === 'open' && this.currentState !== 'open')
      this.handleOpen(snapshot)
    else
      this.handleState(snapshot)
    return snapshot
  }

  async close(): Promise<void> {
    if (this.disposed)
      return
    this.clientTransport.close()
    this.attached = false
    this.hadDemand = false
    this.setState('closed', 'CLIENT_DISCONNECTED')
  }

  sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    this.assertUsable()
    if (!this.attached)
      return Promise.reject(new WwsError('CLIENT_DISCONNECTED', 'Client is not open'))
    return this.sanitizePublicPromise(this.clientTransport.send(data, options))
  }

  onMessage(handler: MessageHandler<Incoming>): () => void {
    this.assertUsable()
    if (typeof handler !== 'function')
      throw new WwsError('INVALID_OPTIONS', 'onMessage handler must be a function')
    const token = Symbol('onMessage')
    this.handlers.set(token, handler)
    return () => {
      this.handlers.delete(token)
    }
  }

  updateAuth(value: Auth, options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.updateAuth(value, options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestAuth = { revision: receipt.revision, value }
      return receipt
    })
  }

  clearAuth(options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.clearAuth(options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestAuth = { revision: receipt.revision, value: undefined }
      return receipt
    })
  }

  updateUrl(url: string | URL, options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    const value = url instanceof URL ? url.href : url
    return this.sanitizePublicPromise(this.clientTransport.updateUrl(value, options.revision)).then((receipt) => {
      if (receipt.status === 'applied')
        this.latestEndpoint = { revision: receipt.revision, url: value }
      return receipt
    })
  }

  reconnect(options?: { reason?: string }): Promise<void> {
    this.assertUsable()
    return this.sanitizePublicPromise(this.clientTransport.reconnect(options?.reason))
  }

  diagnostics(): Readonly<ConnectionDiagnostics> {
    const base = this.clientTransport.diagnostics()
    return Object.freeze({
      attachedClientCount: numberValue(base.attachedClientCount),
      bufferedAmount: numberValue(base.bufferedAmount),
      configFingerprint: stringValue(base.configFingerprint),
      controlProtocolMajor: 1,
      endpointOrigin: stringValue(base.endpointOrigin),
      idHash: stableHash(this.config.id),
      lastErrorCode: base.lastErrorCode === null ? null : stringValue(base.lastErrorCode),
      lastSafeCloseCode: numberOrNull(base.lastSafeCloseCode),
      logicalState: this.currentState,
      nextRetryDelay: numberOrNull(base.nextRetryDelay),
      outboundHighWater: Boolean(base.outboundHighWater),
      physicalState: stateValue(base.physicalState, this.currentState),
      queueBytes: numberValue(base.queueBytes),
      queueMessages: numberValue(base.queueMessages),
      retryAttempt: numberValue(base.retryAttempt),
      transport: this.currentTransport,
      workerInstanceHash: base.workerInstanceHash === null ? null : stringValue(base.workerInstanceHash),
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed)
      return
    this.disposed = true
    for (const cleanup of this.lifecycleCleanups)
      cleanup()
    this.lifecycleCleanups = []
    this.handlers.clear()
    this.clientTransport.dispose()
    this.setState('closed', 'CLIENT_DISPOSED')
  }

  private createSink(): ConnectionSink<Incoming> {
    return {
      id: this.clientId,
      onClose: event => this.handleClose(event),
      onError: error => this.handleError(error),
      onMessage: (data, receivedAt, replayed) => this.handleMessage(data, receivedAt, replayed),
      onOverflow: event => this.dispatchRemoteOverflow(event),
      onOpen: snapshot => this.handleOpen(snapshot),
      onState: (snapshot, reasonCode) => this.handleState(snapshot, reasonCode),
    }
  }

  private handleState(snapshot: ConnectionSnapshot, reasonCode?: string): void {
    this.currentTransport = this.clientTransport.kind
    this.currentWorkerMode = this.clientTransport.workerMode
    this.setState(snapshot.state, reasonCode, snapshot)
  }

  private handleOpen(snapshot: ConnectionSnapshot): void {
    this.setState('open', 'READY', snapshot)
    this.dispatchEvent(new Event('open'))
    try {
      this.options.onConnected?.(this, snapshot)
    }
    catch (cause) {
      this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onConnected callback failed', { cause }))
    }
  }

  private handleMessage(data: Incoming, receivedAt: number, replayed = false): void {
    this.currentData = data
    if (replayed) {
      this.dispatchMessage(data, receivedAt, true)
      return
    }
    if (this.suspended) {
      if (this.restore.replay)
        this.pushReplay(data, receivedAt)
      return
    }
    this.dispatchMessage(data, receivedAt, false)
  }

  private dispatchMessage(data: Incoming, receivedAt: number, replayed: boolean): void {
    const event = createMessageEvent(data, receivedAt, this.clientTransport.kind, replayed)
    for (const handler of [...this.handlers.values()]) {
      try {
        handler(event)
      }
      catch (cause) {
        this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onMessage handler failed', { cause }))
      }
    }
    this.dispatchEvent(event)
  }

  private handleClose(event: { readonly code: number, readonly wasClean: boolean, readonly terminal: boolean, readonly willReconnect: boolean }): void {
    if (!event.willReconnect)
      this.setState('closed', 'SOCKET_CLOSED')
    const closeEvent = createCloseEvent(event)
    this.dispatchEvent(closeEvent)
    try {
      this.options.onDisconnected?.(this, closeEvent)
    }
    catch (cause) {
      this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onDisconnected callback failed', { cause }))
    }
  }

  private handleError(error: WwsError): void {
    const publicError = sanitizeError(error)
    this.dispatchEvent(createErrorEvent(publicError))
    const diagnosticEvent = new Event('diagnostic')
    Object.defineProperty(diagnosticEvent, 'diagnostic', {
      value: Object.freeze({ code: publicError.code, timestamp: Date.now(), type: 'error' }),
    })
    this.dispatchEvent(diagnosticEvent)
    const diagnostic: WwsDiagnosticEvent = publicError.details === undefined
      ? { code: publicError.code, timestamp: Date.now(), type: 'error' }
      : { code: publicError.code, details: publicError.details, timestamp: Date.now(), type: 'error' }
    this.options.logger?.(diagnostic)
    try {
      this.options.onError?.(this, publicError)
    }
    catch {
      // User callback errors cannot affect the transport.
    }
  }

  private setState(state: ConnectionState, reasonCode?: string, snapshot?: ConnectionSnapshot): void {
    const previous = this.currentState
    this.currentState = state
    if (previous === state)
      return
    const event = new Event('statechange') as WwsStateChangeEvent
    Object.defineProperties(event, {
      attempt: { value: snapshot?.attempt ?? 0 },
      previous: { value: previous },
      reasonCode: { value: reasonCode },
      state: { value: state },
      transport: { value: this.currentTransport },
    })
    this.dispatchEvent(event)
  }

  private installLifecycle(): void {
    if (typeof document === 'undefined' || typeof window === 'undefined')
      return
    const suspend = (force = false): void => {
      if (!this.restore.enabled || !this.attached)
        return
      if (force || document.visibilityState === 'hidden' || document.hidden) {
        this.suspended = true
        this.clientTransport.suspend?.()
      }
    }
    const restore = (): void => {
      if (!this.restore.enabled)
        return
      void this.restoreLifecycle()
    }
    const pagehide = (event: PageTransitionEvent): void => {
      if (event.persisted && this.restore.enabled) {
        suspend(true)
        return
      }
      if (this.config.local.autoClose)
        void this.close()
    }
    const visibilityChange = (): void => {
      if (document.visibilityState === 'visible' && !document.hidden)
        restore()
      else
        suspend()
    }
    document.addEventListener('visibilitychange', visibilityChange)
    window.addEventListener('pagehide', pagehide)
    window.addEventListener('pageshow', restore)
    const freeze = (): void => suspend(true)
    document.addEventListener('freeze', freeze)
    document.addEventListener('resume', restore)
    this.lifecycleCleanups.push(
      () => document.removeEventListener('visibilitychange', visibilityChange),
      () => window.removeEventListener('pagehide', pagehide),
      () => window.removeEventListener('pageshow', restore),
      () => document.removeEventListener('freeze', freeze),
      () => document.removeEventListener('resume', restore),
    )
  }

  private async restoreLifecycle(): Promise<void> {
    if (this.recovery !== undefined)
      return this.recovery
    this.recovery = this.performRestoreLifecycle().finally(() => {
      this.recovery = undefined
    })
    return this.recovery
  }

  private async performRestoreLifecycle(): Promise<void> {
    const wasSuspended = this.suspended
    if (!wasSuspended)
      return
    this.suspended = false
    try {
      await this.clientTransport.probe?.()
    }
    catch (error) {
      try {
        await this.recreateTransport()
      }
      catch (recoveryError) {
        this.handleError(recoveryError instanceof WwsError
          ? recoveryError
          : new WwsError('WORKER_DISCONNECTED', 'SharedWorker recovery failed', { cause: error ?? recoveryError, retryable: true }))
        return
      }
    }
    this.clientTransport.restore?.()
    if (wasSuspended && this.restore.replay) {
      const entries = this.replay.splice(0)
      this.replayBytes = 0
      for (const entry of entries)
        this.dispatchMessage(entry.data, entry.receivedAt, true)
    }
  }

  private async recreateTransport(): Promise<void> {
    if (this.clientTransport.kind !== 'shared-worker' || this.recreateSharedTransport === undefined)
      return
    const oldTransport = this.clientTransport
    oldTransport.dispose()
    const replacement = this.recreateSharedTransport()
    this.clientTransport = replacement
    this.currentTransport = replacement.kind
    this.currentWorkerMode = replacement.workerMode
    replacement.attach(this.createSink())
    this.attached = true
    if (this.latestEndpoint !== undefined)
      await replacement.updateUrl(this.latestEndpoint.url, this.latestEndpoint.revision)
    if (this.latestAuth !== undefined) {
      if (this.latestAuth.value === undefined)
        await replacement.clearAuth(this.latestAuth.revision)
      else
        await replacement.updateAuth(this.latestAuth.value, this.latestAuth.revision)
    }
    if (this.hadDemand)
      await this.sanitizePublicPromise(replacement.open())
  }

  private async sanitizePublicPromise<Value>(promise: Promise<Value>): Promise<Value> {
    try {
      return await promise
    }
    catch (error) {
      const value = error instanceof WwsError
        ? error
        : toWwsError(error, 'INTERNAL_STATE_ERROR', 'WebSocket operation failed')
      throw sanitizeError(value)
    }
  }

  private pushReplay(data: Incoming, receivedAt: number): void {
    const bytes = estimateValueBytes(data)
    if (bytes > this.restore.maxBytes) {
      this.overflowCount++
      this.dispatchOverflow(bytes, 'drop-oldest')
      return
    }
    while (this.replay.length >= this.restore.maxMessages || this.replayBytes + bytes > this.restore.maxBytes) {
      const removed = this.replay.shift()
      if (removed === undefined)
        break
      this.replayBytes -= removed.bytes
      this.overflowCount++
      this.dispatchOverflow(removed.bytes, 'drop-oldest')
    }
    this.replay.push({ bytes, data, receivedAt })
    this.replayBytes += bytes
  }

  private dispatchOverflow(bytes: number, strategy: WwsOverflowEvent['strategy']): void {
    const event = new Event('overflow') as WwsOverflowEvent
    Object.defineProperties(event, {
      direction: { value: 'replay' },
      droppedBytes: { value: bytes },
      droppedMessages: { value: 1 },
      strategy: { value: strategy },
    })
    this.dispatchEvent(event)
  }

  private dispatchRemoteOverflow(event: { readonly direction: 'inbound' | 'replay', readonly strategy: 'drop-newest' | 'drop-oldest', readonly droppedMessages: number, readonly droppedBytes: number }): void {
    const overflow = new Event('overflow') as WwsOverflowEvent
    Object.defineProperties(overflow, {
      direction: { value: event.direction },
      droppedBytes: { value: event.droppedBytes },
      droppedMessages: { value: event.droppedMessages },
      strategy: { value: event.strategy },
    })
    this.dispatchEvent(overflow)
  }

  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'WebSocket client has been disposed')
  }
}
