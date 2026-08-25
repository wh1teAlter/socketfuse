/**
 * `wws` 浏览器端公开入口。
 *
 * 这里只转出稳定 facade 与类型，不让消费者依赖私有 `@wws/core` 包或 Worker 内部实现。
 */
export { createWebSocket } from './api/create-websocket'
export { isWwsError, WWS_ERROR_CODES, WwsError } from '@wws/core'
export type {
  BackpressureOptions,
  ConnectionDiagnostics,
  ConnectionLimits,
  ConnectionSnapshot,
  ConnectionState,
  CreateWebSocketOptions,
  HeartbeatOptions,
  JsonAuthTemplate,
  JsonHeartbeatTemplate,
  JsonMatcher,
  JsonProtocolOptions,
  JsonValue,
  LeaseOptions,
  LifecycleOptions,
  ProtocolCapabilities,
  QueueOptions,
  ReadyState,
  ReconnectOptions,
  RestoreOptions,
  RevisionReceipt,
  SendOptions,
  SendReceipt,
  SocketData,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
  WwsCloseEvent,
  WwsDiagnosticEvent,
  WwsErrorCode,
  WwsLogger,
  WwsMessageEvent,
  WwsOverflowEvent,
  WwsStateChangeEvent,
} from '@wws/core'
