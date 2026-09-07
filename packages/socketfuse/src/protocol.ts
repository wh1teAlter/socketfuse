/**
 * `socketfuse/protocol` 公开协议入口。
 *
 * 页面和自定义 Worker 通过此入口共享 raw、JSON 及自定义 adapter 的类型契约。
 */
export { rawProtocol } from '@socketfuse/core'
export type {
  ClassifyContext,
  DecodeContext,
  EncodeContext,
  HeartbeatContext,
  JsonHeartbeatTemplate,
  JsonMatcher,
  JsonProtocolOptions,
  JsonValue,
  ProtocolAdapter,
  ProtocolContext,
  ProtocolFrame,
  SafeCloseInfo,
  SocketData,
} from '@socketfuse/core'
