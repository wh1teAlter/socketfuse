/**
 * SocketFuse 共享连接与 Worker 资源的默认边界。
 *
 * 这些值只提供安全基线；页面可调整连接级配置，但 Worker 级资源上限只能由 Worker
 * 创建者设置，以避免任意页面放宽控制平面保护。
 */
import type { BackpressureOptions, ConnectionLimits, HeartbeatOptions, LeaseOptions, QueueOptions, ReconnectOptions, WorkerResourceLimits } from './types'

/** page-to-Worker 控制协议的当前破坏性版本号。 */
export const CONTROL_PROTOCOL_MAJOR: number = 1
/** 一个 mebibyte 的字节数，统一用于内存与 payload 上限。 */
export const MIB: number = 1024 * 1024

/** socket open 与 adapter handshake 共用的默认超时，单位为毫秒。 */
export const DEFAULT_CONNECTION_TIMEOUT: number = 10_000
/** 最后一个 client 离开后关闭物理 socket 前的默认宽限期，单位为毫秒。 */
export const DEFAULT_IDLE_GRACE_MS: number = 5_000
/** restore 回放缓冲的默认消息数上限。 */
export const DEFAULT_REPLAY_MAX_MESSAGES: number = 256
/** restore 回放缓冲的默认 payload 字节上限。 */
export const DEFAULT_REPLAY_MAX_BYTES: number = 4 * MIB

/** 未指定时使用的共享指数退避策略。 */
export const DEFAULT_RECONNECT_OPTIONS: Readonly<ReconnectOptions> = Object.freeze({
  factor: 2,
  initialDelay: 1_000,
  jitter: 0.2,
  maxDelay: 30_000,
  retries: Number.POSITIVE_INFINITY,
  stableThreshold: 30_000,
})

/** 未指定时使用的共享应用层心跳策略。 */
export const DEFAULT_HEARTBEAT_OPTIONS: Readonly<HeartbeatOptions> = Object.freeze({
  interval: 25_000,
  message: 'ping',
  mode: 'pong',
  pongTimeout: 10_000,
  responseMessage: 'pong',
})

/** 未指定时使用的有界出站队列策略。 */
export const DEFAULT_QUEUE_OPTIONS: Readonly<QueueOptions> = Object.freeze({
  maxBytes: MIB,
  maxMessages: 100,
  whenBackpressured: false,
  whenDisconnected: false,
})

/** 未指定时使用的原生 socket 背压高低水位，单位为字节。 */
export const DEFAULT_BACKPRESSURE_OPTIONS: Readonly<BackpressureOptions> = Object.freeze({
  highWaterMarkBytes: MIB,
  lowWaterMarkBytes: 256 * 1024,
})

/** 页面端正常/异常离开判定的默认 lease 参数，单位为毫秒。 */
export const DEFAULT_LEASE_OPTIONS: Readonly<LeaseOptions> = Object.freeze({
  interval: 20_000,
  timeout: 60_000,
})

/** 单条共享物理 socket 的默认资源上限。 */
export const DEFAULT_CONNECTION_LIMITS: Readonly<ConnectionLimits> = Object.freeze({
  maxClientsPerConnection: 64,
  maxEncodedMessageBytes: MIB,
})

/** custom 或 inline Worker 的默认控制平面资源上限。 */
export const DEFAULT_WORKER_RESOURCE_LIMITS: Readonly<WorkerResourceLimits> = Object.freeze({
  maxControlEnvelopeBytes: 2 * MIB,
  maxPorts: 256,
  unattachedPortTimeoutMs: 5_000,
})
