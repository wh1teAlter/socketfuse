/**
 * `socketfuse/worker` 自定义 SharedWorker 入口。
 *
 * 该模块只提供 Worker runtime 装配能力；页面连接仍通过 `socketfuse` 的
 * `createWebSocket` 创建。
 */
export { createSharedWebSocketRuntime, defineWorkerProtocol, exposeSharedWebSocketWorker } from '@socketfuse/core'
export type {
  AttemptPreparationContext,
  ConnectionExtension,
  ConnectionExtensionContext,
  ConnectionExtensionFactory,
  ConnectionFrame,
  FrameResult,
  MessagePortLike,
  SharedWebSocketRuntime,
  SharedWebSocketRuntimeOptions,
  SharedWorkerGlobalLike,
  WorkerProtocolRegistration,
  WorkerResourceLimits,
} from '@socketfuse/core'
