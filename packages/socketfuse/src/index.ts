/**
 * `socketfuse` 浏览器端公开入口。
 *
 * 这里只转出稳定 facade 与类型，不让消费者依赖私有 `@socketfuse/core` 包或 Worker 内部实现。
 */
export { createWebSocket } from './api/create-websocket'
export { isSocketFuseError, SOCKET_FUSE_ERROR_CODES, SocketFuseError } from '@socketfuse/core'
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
  SocketFuseCloseEvent,
  SocketFuseDiagnosticEvent,
  SocketFuseErrorCode,
  SocketFuseLogger,
  SocketFuseMessageEvent,
  SocketFuseOverflowEvent,
  SocketFuseStateChangeEvent,
  Transport,
  WebSocketClient,
  WebSocketStatus,
  WorkerMode,
} from '@socketfuse/core'
