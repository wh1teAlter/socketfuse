import type { WwsError } from './errors'

export type SocketData = string | Blob | ArrayBuffer | ArrayBufferView
export type TimerHandle = number | ReturnType<typeof setTimeout>

export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED'

export type ConnectionState
  = | 'idle'
    | 'connecting'
    | 'handshaking'
    | 'open'
    | 'reconnecting'
    | 'closing'
    | 'closed'
    | 'failed'

export type ReadyState = 0 | 1 | 2 | 3
export type Transport = 'pending' | 'shared-worker' | 'direct'
export type WorkerMode = 'inline' | 'custom' | 'none'

export interface ProtocolCapabilities {
  readonly auth: boolean
  readonly heartbeat: boolean
  readonly binary: boolean
}

export interface ReconnectOptions {
  retries: number
  initialDelay: number
  maxDelay: number
  factor: number
  jitter: number
  stableThreshold: number
}

export interface HeartbeatOptions {
  mode: 'pong' | 'activity'
  interval: number
  pongTimeout: number
  message: SocketData
  responseMessage: SocketData
}

export interface QueueOptions {
  whenDisconnected: boolean
  whenBackpressured: boolean
  maxMessages: number
  maxBytes: number
}

export interface BackpressureOptions {
  highWaterMarkBytes: number
  lowWaterMarkBytes: number
}

export interface LeaseOptions {
  interval: number
  timeout: number
}

export interface ResourceLimits {
  maxPortsPerWorker: number
  maxClientsPerConnection: number
  maxEncodedMessageBytes: number
  maxControlEnvelopeBytes: number
  unattachedPortTimeoutMs: number
}

export interface RestoreOptions {
  replay?: boolean
  maxMessages?: number
  maxBytes?: number
}

export interface LifecycleOptions {
  restore?: boolean | RestoreOptions
}

export interface NormalizedRestoreOptions {
  enabled: boolean
  replay: boolean
  maxMessages: number
  maxBytes: number
}

export interface SendOptions {
  queue?: boolean
  idempotencyKey?: string
}

export type SendReceipt
  = | { readonly status: 'accepted', readonly messageId: string, readonly bufferedAmount: number }
    | { readonly status: 'queued', readonly messageId: string, readonly position: number }

export type RevisionReceipt
  = | { readonly status: 'applied', readonly revision: number }
    | { readonly status: 'stale', readonly revision: number }
    | { readonly status: 'unchanged', readonly revision: number }

export interface ConnectionSnapshot {
  readonly state: ConnectionState
  readonly status: WebSocketStatus
  readonly readyState: ReadyState
  readonly transport: Transport
  readonly attempt: number
  readonly connectedAt: number
}

export interface WwsMessageEvent<Data> extends Event {
  readonly data: Data
  readonly receivedAt: number
  readonly transport: Exclude<Transport, 'pending'>
  readonly replayed: boolean
}

export interface WwsCloseEvent extends Event {
  readonly code: number
  readonly wasClean: boolean
  readonly terminal: boolean
  readonly willReconnect: boolean
}

export interface WwsStateChangeEvent extends Event {
  readonly previous: ConnectionState
  readonly state: ConnectionState
  readonly transport: Transport
  readonly attempt: number
  readonly reasonCode?: string
}

export interface WwsOverflowEvent extends Event {
  readonly direction: 'outbound' | 'inbound' | 'replay'
  readonly strategy: 'reject-newest' | 'drop-newest' | 'drop-oldest'
  readonly droppedMessages: number
  readonly droppedBytes: number
}

export interface WwsDiagnosticEvent {
  readonly type: string
  readonly timestamp: number
  readonly code?: string
  readonly details?: Readonly<Record<string, unknown>>
}

export type WwsLogger = (event: Readonly<WwsDiagnosticEvent>) => void

export interface ConnectionDiagnostics {
  readonly transport: Transport
  readonly logicalState: ConnectionState
  readonly physicalState: ConnectionState
  readonly workerInstanceHash: string | null
  readonly controlProtocolMajor: number
  readonly idHash: string
  readonly configFingerprint: string
  readonly endpointOrigin: string
  readonly retryAttempt: number
  readonly nextRetryDelay: number | null
  readonly lastSafeCloseCode: number | null
  readonly attachedClientCount: number
  readonly queueMessages: number
  readonly queueBytes: number
  readonly bufferedAmount: number
  readonly outboundHighWater: boolean
  readonly lastErrorCode: string | null
}

export type JsonPrimitive = null | boolean | number | string
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Matcher keys are dot/bracket field paths; values are compared structurally. */
export type JsonMatcher = Readonly<Record<string, JsonValue>>

/** Strings equal to `$auth` or starting with `$auth.` are replaced from auth data. */
export interface JsonAuthTemplate {
  readonly template: JsonValue
}

export interface JsonHeartbeatTemplate {
  readonly ping: JsonValue
  readonly pong: JsonMatcher
  readonly serverPing?: JsonMatcher
  readonly serverPong?: JsonValue
}

export interface JsonProtocolOptions {
  readonly type: 'json'
  readonly id?: string
  readonly version?: number
  readonly ready?: JsonMatcher
  readonly auth?: JsonAuthTemplate
  readonly heartbeat?: JsonHeartbeatTemplate
  readonly ignore?: readonly JsonMatcher[]
}

export interface ProtocolContext {
  readonly now: number
}

export interface EncodeContext extends ProtocolContext {
  readonly messageId: string
}

export interface DecodeContext extends ProtocolContext {
  readonly receivedAt: number
}

export interface ClassifyContext extends ProtocolContext {
  readonly receivedAt: number
}

export interface AuthContext extends ProtocolContext {
  readonly revision: number
}

export interface HeartbeatContext extends ProtocolContext {
  readonly attempt: number
}

export interface SafeCloseInfo {
  readonly code: number
  readonly wasClean: boolean
  readonly terminal: boolean
}

export type ProtocolFrame<Data>
  = | { readonly type: 'data', readonly data: Data }
    | { readonly type: 'ready' }
    | { readonly type: 'ping', readonly data: Data }
    | { readonly type: 'pong' }
    | { readonly type: 'ignore' }
    | { readonly type: 'fatal', readonly code?: string }

export type MaybePromise<Value> = Value | Promise<Value>

export interface ProtocolAdapter<Incoming, Outgoing, Auth = unknown> {
  readonly id: string
  readonly version: number
  readonly capabilities: ProtocolCapabilities
  readonly sharedConfig?: Readonly<Record<string, unknown>>
  readonly readyWhen?: 'socket-open' | 'adapter-frame'
  encode: (data: Outgoing, context: EncodeContext) => MaybePromise<SocketData>
  decode: (data: SocketData, context: DecodeContext) => MaybePromise<Incoming>
  classify: (data: Incoming, context: ClassifyContext) => MaybePromise<ProtocolFrame<Incoming>>
  createAuth?: (auth: Auth, context: AuthContext) => MaybePromise<Outgoing | readonly Outgoing[]>
  createPing?: (context: HeartbeatContext) => MaybePromise<Outgoing>
  createPong?: (ping: ProtocolFrame<Incoming>, context: HeartbeatContext) => MaybePromise<Outgoing>
  shouldReconnect?: (close: SafeCloseInfo) => boolean
}

export type ProtocolSelector<Incoming, Outgoing, Auth>
  = | 'raw'
    | JsonProtocolOptions
    | ProtocolAdapter<Incoming, Outgoing, Auth>

export interface CreateWebSocketOptions<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> {
  id: string
  protocols?: string | readonly string[]
  worker?: () => SharedWorker
  protocol?: ProtocolSelector<Incoming, Outgoing, Auth>
  fallback?: 'direct' | 'error'
  immediate?: boolean
  autoClose?: boolean
  autoReconnect?: boolean | Partial<ReconnectOptions>
  connectionTimeout?: number
  binaryType?: 'arraybuffer' | 'blob'
  heartbeat?: boolean | Partial<HeartbeatOptions>
  queue?: boolean | Partial<QueueOptions>
  backpressure?: Partial<BackpressureOptions>
  lease?: Partial<LeaseOptions>
  lifecycle?: LifecycleOptions
  limits?: Partial<ResourceLimits>
  idleGraceMs?: number
  logger?: WwsLogger
  onConnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, snapshot: ConnectionSnapshot) => void
  onDisconnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: WwsCloseEvent) => void
  onError?: (client: WebSocketClient<Incoming, Outgoing, Auth>, error: WwsError) => void
  onMessage?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: WwsMessageEvent<Incoming>) => void
}

export interface WebSocketClient<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> extends EventTarget {
  readonly data: Incoming | null
  readonly status: WebSocketStatus
  readonly state: ConnectionState
  readonly readyState: ReadyState
  readonly transport: Transport
  readonly workerMode: WorkerMode
  readonly capabilities: ProtocolCapabilities
  open: (options?: { signal?: AbortSignal }) => Promise<ConnectionSnapshot>
  close: () => Promise<void>
  sendMessage: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  onMessage: (handler: (event: WwsMessageEvent<Incoming>) => void) => () => void
  updateAuth: (auth: Auth, options: { revision: number }) => Promise<RevisionReceipt>
  clearAuth: (options: { revision: number }) => Promise<RevisionReceipt>
  updateUrl: (url: string | URL, options: { revision: number }) => Promise<RevisionReceipt>
  reconnect: (options?: { reason?: string }) => Promise<void>
  diagnostics: () => Readonly<ConnectionDiagnostics>
  dispose: () => Promise<void>
}
