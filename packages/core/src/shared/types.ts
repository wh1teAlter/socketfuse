import type { WwsError } from './errors'

/** WebSocket payload types accepted by browsers and the raw protocol. */
export type SocketData = string | Blob | ArrayBuffer | ArrayBufferView
export type TimerHandle = number | ReturnType<typeof setTimeout>

/** Compact, VueUse-style status derived from the detailed connection state. */
export type WebSocketStatus = 'OPEN' | 'CONNECTING' | 'CLOSED'

/** Detailed logical lifecycle state of a page client. */
export type ConnectionState
  = | 'idle'
    | 'connecting'
    | 'handshaking'
    | 'open'
    | 'reconnecting'
    | 'closing'
    | 'closed'
    | 'failed'

/** Native WebSocket-compatible numeric ready state. */
export type ReadyState = 0 | 1 | 2 | 3
/** Transport currently selected for the page client. */
export type Transport = 'pending' | 'shared-worker' | 'direct'
/** Worker deployment mode used by the selected transport. */
export type WorkerMode = 'inline' | 'custom' | 'none'

/** Features implemented by the selected protocol adapter. */
export interface ProtocolCapabilities {
  readonly auth: boolean
  readonly heartbeat: boolean
  readonly binary: boolean
}

/** Shared reconnect policy. Delays are expressed in milliseconds. */
export interface ReconnectOptions {
  /** Maximum retries, or `Infinity`. Defaults to `Infinity`. */
  retries: number
  /** Base retry delay. Defaults to `1000`. */
  initialDelay: number
  /** Maximum retry delay. Defaults to `30000`. */
  maxDelay: number
  /** Exponential multiplier. Defaults to `2`. */
  factor: number
  /** Random delay ratio from `0` to `1`. Defaults to `0.2`. */
  jitter: number
  /** Open duration after which the retry counter resets. Defaults to `30000`. */
  stableThreshold: number
}

/** Shared heartbeat policy. Intervals are expressed in milliseconds. */
export interface HeartbeatOptions {
  mode: 'pong' | 'activity'
  interval: number
  pongTimeout: number
  message: SocketData
  responseMessage: SocketData
}

/** Shared bounded outbound queue policy. */
export interface QueueOptions {
  /** Queue while the socket is disconnected. Defaults to `false`. */
  whenDisconnected: boolean
  /** Queue while buffered data is above the high-water mark. Defaults to `false`. */
  whenBackpressured: boolean
  /** Maximum queued message count. Defaults to `100`. */
  maxMessages: number
  /** Maximum encoded queue size. Defaults to 1 MiB. */
  maxBytes: number
}

/** Shared WebSocket buffered-amount thresholds, in bytes. */
export interface BackpressureOptions {
  highWaterMarkBytes: number
  lowWaterMarkBytes: number
}

/** Shared page-client liveness lease, in milliseconds. */
export interface LeaseOptions {
  interval: number
  timeout: number
}

/** Limits that belong to one shared physical WebSocket connection. */
export interface ConnectionLimits {
  maxClientsPerConnection: number
  maxEncodedMessageBytes: number
}

/** Static limits that protect one SharedWorker control plane. */
export interface WorkerResourceLimits {
  maxPorts: number
  maxControlEnvelopeBytes: number
  unattachedPortTimeoutMs: number
}

/** Page-local buffering used while a lifecycle-aware page is suspended. */
export interface RestoreOptions {
  /** Replay buffered messages through `onMessage` on restore. Defaults to `false`. */
  replay?: boolean
  /** Maximum buffered messages. Defaults to `256`. */
  maxMessages?: number
  /** Maximum buffered bytes. Defaults to 4 MiB. */
  maxBytes?: number
}

/** Page-local browser lifecycle integration. Disabled by default. */
export interface LifecycleOptions {
  restore?: boolean | RestoreOptions
}

export interface NormalizedRestoreOptions {
  enabled: boolean
  replay: boolean
  maxMessages: number
  maxBytes: number
}

/** Controls one `sendMessage` operation. */
export interface SendOptions {
  /** Override shared queue eligibility for this send. */
  queue?: boolean
  /** Application key retained with a queued message; WWS does not implement server Ack. */
  idempotencyKey?: string
}

/** Local acceptance result from `sendMessage`; it is not a server delivery receipt. */
export type SendReceipt
  = | { readonly status: 'accepted', readonly messageId: string, readonly bufferedAmount: number }
    | { readonly status: 'queued', readonly messageId: string, readonly position: number }

/** Result of a monotonic endpoint or auth revision update. */
export type RevisionReceipt
  = | { readonly status: 'applied', readonly revision: number }
    | { readonly status: 'stale', readonly revision: number }
    | { readonly status: 'unchanged', readonly revision: number }

/** Immutable connection state returned when `open()` resolves. */
export interface ConnectionSnapshot {
  readonly state: ConnectionState
  readonly status: WebSocketStatus
  readonly readyState: ReadyState
  readonly transport: Transport
  readonly attempt: number
  readonly connectedAt: number
}

/** Business message delivered to page listeners. Protocol control frames are excluded. */
export interface WwsMessageEvent<Data> extends Event {
  /** Decoded application payload. */
  readonly data: Data
  /** Receive timestamp in milliseconds since the Unix epoch. */
  readonly receivedAt: number
  /** Transport that received the message. */
  readonly transport: Exclude<Transport, 'pending'>
  /** Whether lifecycle restore replayed this message. */
  readonly replayed: boolean
}

/** Logical close notification for this page client. */
export interface WwsCloseEvent extends Event {
  readonly code: number
  readonly wasClean: boolean
  readonly terminal: boolean
  readonly willReconnect: boolean
}

/** Detailed logical state transition notification. */
export interface WwsStateChangeEvent extends Event {
  readonly previous: ConnectionState
  readonly state: ConnectionState
  readonly transport: Transport
  readonly attempt: number
  readonly reasonCode?: string
}

/** Bounded queue or replay overflow notification. */
export interface WwsOverflowEvent extends Event {
  readonly direction: 'outbound' | 'inbound' | 'replay'
  readonly strategy: 'reject-newest' | 'drop-newest' | 'drop-oldest'
  readonly droppedMessages: number
  readonly droppedBytes: number
}

/** Sanitized operational event passed to the optional logger. */
export interface WwsDiagnosticEvent {
  readonly type: string
  readonly timestamp: number
  readonly code?: string
  readonly details?: Readonly<Record<string, unknown>>
}

/** Receives sanitized diagnostics and must not be used as a message listener. */
export type WwsLogger = (event: Readonly<WwsDiagnosticEvent>) => void

/** Sanitized point-in-time metrics for a logical and physical connection. */
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

/** JSON primitive accepted by the declarative JSON adapter. */
export type JsonPrimitive = null | boolean | number | string
/** Structured JSON value accepted by declarative templates and matchers. */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Matcher keys are dot/bracket field paths; values are compared structurally. */
export type JsonMatcher = Readonly<Record<string, JsonValue>>

/** Strings equal to `$auth` or starting with `$auth.` are replaced from auth data. */
export interface JsonAuthTemplate {
  readonly template: JsonValue
}

/** Declarative JSON ping/pong templates and matchers. */
export interface JsonHeartbeatTemplate {
  readonly ping: JsonValue
  readonly pong: JsonMatcher
  readonly serverPing?: JsonMatcher
  readonly serverPong?: JsonValue
}

/** Declarative JSON protocol definition shared by every tab using an `id`. */
export interface JsonProtocolOptions {
  readonly type: 'json'
  readonly id?: string
  readonly version?: number
  readonly ready?: JsonMatcher
  readonly auth?: JsonAuthTemplate
  readonly heartbeat?: JsonHeartbeatTemplate
  readonly ignore?: readonly JsonMatcher[]
}

/** Timestamp supplied to protocol adapter operations. */
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

/** Sanitized close data supplied to adapter retry decisions. */
export interface SafeCloseInfo {
  readonly code: number
  readonly wasClean: boolean
  readonly terminal: boolean
}

/** Classification result separating business data from protocol control frames. */
export type ProtocolFrame<Data>
  = | { readonly type: 'data', readonly data: Data }
    | { readonly type: 'ready' }
    | { readonly type: 'ping', readonly data: Data }
    | { readonly type: 'pong' }
    | { readonly type: 'ignore' }
    | { readonly type: 'fatal', readonly code?: string }

export type MaybePromise<Value> = Value | Promise<Value>

/**
 * Defines encoding and control-frame semantics for one application protocol.
 *
 * Adapter functions execute inside a custom Worker and never cross MessagePort.
 * `id`, `version`, capabilities, readiness and `sharedConfig` form the shared
 * protocol identity used for connection conflict detection.
 *
 * @typeParam Incoming Decoded business payload delivered to page listeners.
 * @typeParam Outgoing Application value accepted by `sendMessage`.
 * @typeParam Auth Revisioned authentication value accepted by `updateAuth`.
 */
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

/** Raw, declarative JSON or custom Worker-registered protocol selection. */
export type ProtocolSelector<Incoming, Outgoing, Auth>
  = | 'raw'
    | JsonProtocolOptions
    | ProtocolAdapter<Incoming, Outgoing, Auth>

/**
 * Configuration for a page client and its shared physical connection.
 *
 * Options that affect physical socket behavior must match for clients reusing
 * an `id`. Page-local options are identified below and do not enter the shared
 * configuration fingerprint.
 */
export interface CreateWebSocketOptions<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> {
  /** Stable application identity used to share a connection across same-origin tabs. */
  id: string
  /** WebSocket subprotocol token or ordered tokens. Defaults to none. */
  protocols?: string | readonly string[]
  /** Page-local custom SharedWorker factory. Defaults to the built-in inline Worker. */
  worker?: () => SharedWorker
  /** Message protocol. Defaults to the raw adapter. */
  protocol?: ProtocolSelector<Incoming, Outgoing, Auth>
  /** Page-local behavior when Worker setup fails. Defaults to `direct`. */
  fallback?: 'direct' | 'error'
  /** Open immediately after creation. Page-local; defaults to `true`. */
  immediate?: boolean
  /** Detach automatically during page teardown. Page-local; defaults to `true`. */
  autoClose?: boolean
  /** Shared reconnect policy. `true` or omission uses exponential defaults. */
  autoReconnect?: boolean | Partial<ReconnectOptions>
  /** Shared open/handshake timeout in milliseconds. Defaults to `10000`. */
  connectionTimeout?: number
  /** Shared binary receive representation. Defaults to `arraybuffer`. */
  binaryType?: 'arraybuffer' | 'blob'
  /** Shared heartbeat policy. Disabled by default and requires adapter support. */
  heartbeat?: boolean | Partial<HeartbeatOptions>
  /** Shared bounded outbound queue policy. Queueing is disabled by default. */
  queue?: boolean | Partial<QueueOptions>
  /** Shared buffered-amount thresholds. */
  backpressure?: Partial<BackpressureOptions>
  /** Shared client liveness lease. */
  lease?: Partial<LeaseOptions>
  /** Page-local freeze/restore handling. Disabled by default. */
  lifecycle?: LifecycleOptions
  /** Shared physical connection resource limits. */
  limits?: Partial<ConnectionLimits>
  /** Delay before closing an unused physical socket, in milliseconds. Defaults to `5000`. */
  idleGraceMs?: number
  /** Page-local sink for sanitized operational diagnostics. */
  logger?: WwsLogger
  /** Page-local callback invoked when the logical client opens. */
  onConnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, snapshot: ConnectionSnapshot) => void
  /** Page-local callback invoked when the logical client closes. */
  onDisconnected?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: WwsCloseEvent) => void
  /** Page-local callback invoked for a sanitized `WwsError`. */
  onError?: (client: WebSocketClient<Incoming, Outgoing, Auth>, error: WwsError) => void
  /** Initial page-local business message callback; more can be added with `onMessage`. */
  onMessage?: (client: WebSocketClient<Incoming, Outgoing, Auth>, event: WwsMessageEvent<Incoming>) => void
}

/**
 * Page-local proxy for a SharedWorker-owned or direct WebSocket connection.
 *
 * @typeParam Incoming Decoded business payload delivered by `onMessage`.
 * @typeParam Outgoing Application value accepted by `sendMessage`.
 * @typeParam Auth Revisioned authentication value accepted by `updateAuth`.
 */
export interface WebSocketClient<Incoming = SocketData, Outgoing = SocketData, Auth = unknown> extends EventTarget {
  /** Most recently delivered business payload, or `null` before the first message. */
  readonly data: Incoming | null
  /** Compact `CONNECTING`, `OPEN` or `CLOSED` status. */
  readonly status: WebSocketStatus
  /** Detailed logical lifecycle state. */
  readonly state: ConnectionState
  /** Native WebSocket-compatible numeric ready state. */
  readonly readyState: ReadyState
  /** Currently selected transport. */
  readonly transport: Transport
  /** Inline, custom or no Worker deployment mode. */
  readonly workerMode: WorkerMode
  /** Capabilities declared by the selected protocol adapter. */
  readonly capabilities: ProtocolCapabilities
  /** Open the logical client; multiple callers share the in-flight operation. */
  open: (options?: { signal?: AbortSignal }) => Promise<ConnectionSnapshot>
  /** Close this page's logical participation without disposing the instance. */
  close: () => Promise<void>
  /** Submit or queue one message and resolve with a local acceptance receipt. */
  sendMessage: (data: Outgoing, options?: SendOptions) => Promise<SendReceipt>
  /** Add a dynamic business message handler and return its removal function. */
  onMessage: (handler: (event: WwsMessageEvent<Incoming>) => void) => () => void
  /** Apply authentication data when `revision` is newer than the shared register. */
  updateAuth: (auth: Auth, options: { revision: number }) => Promise<RevisionReceipt>
  /** Clear authentication and pending business data using a newer revision. */
  clearAuth: (options: { revision: number }) => Promise<RevisionReceipt>
  /** Apply a new endpoint using the shared monotonic endpoint register. */
  updateUrl: (url: string | URL, options: { revision: number }) => Promise<RevisionReceipt>
  /** Explicitly start a new connection attempt. */
  reconnect: (options?: { reason?: string }) => Promise<void>
  /** Return sanitized operational metrics without auth, query or payload data. */
  diagnostics: () => Readonly<ConnectionDiagnostics>
  /** Permanently release the client, handlers and transport participation. */
  dispose: () => Promise<void>
}
