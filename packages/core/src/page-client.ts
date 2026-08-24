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
} from './types'
import type { ConnectionSink } from './connection-controller'
import type { NormalizedWebSocketConfig } from './config'
import type { ClientTransport } from './direct-transport'
import { readyStateFor, statusFor } from './connection-state'
import { stableHash } from './structured'
import { WwsError } from './errors'

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
  const options = { fatal: error.fatal, retryable: error.retryable }
  return details === undefined
    ? new WwsError(error.code, error.message, options)
    : new WwsError(error.code, error.message, { ...options, details })
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
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  }
  catch {
    return 0
  }
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

  constructor(
    readonly config: NormalizedWebSocketConfig<Incoming, Outgoing, Auth>,
    readonly clientTransport: ClientTransport<Incoming, Outgoing, Auth>,
    readonly options: CreateWebSocketOptions<Incoming, Outgoing, Auth>,
    readonly clientId: string,
  ) {
    super()
    this.currentTransport = clientTransport.kind
    this.currentWorkerMode = clientTransport.workerMode
    this.restore = config.local.lifecycle
    if (options.onMessage !== undefined)
      this.onMessage(event => options.onMessage?.(this, event))
    if (this.restore.enabled)
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
    const snapshot = await this.clientTransport.open(options?.signal)
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
    this.setState('closed', 'CLIENT_DISCONNECTED')
  }

  sendMessage(data: Outgoing, options?: SendOptions): Promise<SendReceipt> {
    this.assertUsable()
    if (!this.attached)
      return Promise.reject(new WwsError('CLIENT_DISCONNECTED', 'Client is not open'))
    return this.clientTransport.send(data, options)
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
    return this.clientTransport.updateAuth(value, options.revision)
  }

  clearAuth(options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.clientTransport.clearAuth(options.revision)
  }

  updateUrl(url: string | URL, options: { revision: number }): Promise<RevisionReceipt> {
    this.assertUsable()
    return this.clientTransport.updateUrl(url instanceof URL ? url.href : url, options.revision)
  }

  reconnect(options?: { reason?: string }): Promise<void> {
    this.assertUsable()
    return this.clientTransport.reconnect(options?.reason)
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
    this.clientTransport.detach(this.clientId)
    this.clientTransport.dispose()
    this.setState('closed', 'CLIENT_DISPOSED')
  }

  private createSink(): ConnectionSink<Incoming> {
    return {
      id: this.clientId,
      onClose: event => this.handleClose(event),
      onError: error => this.handleError(error),
      onMessage: (data, receivedAt, replayed) => this.handleMessage(data, receivedAt, replayed),
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
    if (this.suspended && this.restore.replay) {
      this.pushReplay(data, receivedAt)
      return
    }
    this.dispatchMessage(data, receivedAt, false)
  }

  private dispatchMessage(data: Incoming, receivedAt: number, replayed: boolean): void {
    const event = createMessageEvent(data, receivedAt, this.clientTransport.kind, replayed)
    this.dispatchEvent(event)
    for (const handler of [...this.handlers.values()]) {
      try {
        handler(event)
      }
      catch (cause) {
        this.handleError(new WwsError('INTERNAL_STATE_ERROR', 'onMessage handler failed', { cause }))
      }
    }
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
    const suspend = (): void => {
      if (document.visibilityState === 'hidden' || document.hidden) {
        this.suspended = true
        this.clientTransport.suspend?.()
      }
    }
    const restore = (): void => {
      const wasSuspended = this.suspended
      this.suspended = false
      this.clientTransport.restore?.()
      if (wasSuspended && this.restore.replay) {
        const entries = this.replay.splice(0)
        this.replayBytes = 0
        for (const entry of entries)
          this.dispatchMessage(entry.data, entry.receivedAt, true)
      }
    }
    document.addEventListener('visibilitychange', suspend)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', restore)
    document.addEventListener('freeze', suspend)
    document.addEventListener('resume', restore)
    this.lifecycleCleanups.push(
      () => document.removeEventListener('visibilitychange', suspend),
      () => window.removeEventListener('pagehide', suspend),
      () => window.removeEventListener('pageshow', restore),
      () => document.removeEventListener('freeze', suspend),
      () => document.removeEventListener('resume', restore),
    )
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

  private assertUsable(): void {
    if (this.disposed)
      throw new WwsError('CLIENT_DISPOSED', 'WebSocket client has been disposed')
  }
}
