import type { BackpressureOptions, ConnectionLimits, HeartbeatOptions, LeaseOptions, QueueOptions, ReconnectOptions, WorkerResourceLimits } from './types'

export const CONTROL_PROTOCOL_MAJOR: number = 1
export const MIB: number = 1024 * 1024

export const DEFAULT_CONNECTION_TIMEOUT: number = 10_000
export const DEFAULT_IDLE_GRACE_MS: number = 5_000
export const DEFAULT_REPLAY_MAX_MESSAGES: number = 256
export const DEFAULT_REPLAY_MAX_BYTES: number = 4 * MIB

export const DEFAULT_RECONNECT_OPTIONS: Readonly<ReconnectOptions> = Object.freeze({
  factor: 2,
  initialDelay: 1_000,
  jitter: 0.2,
  maxDelay: 30_000,
  retries: Number.POSITIVE_INFINITY,
  stableThreshold: 30_000,
})

export const DEFAULT_HEARTBEAT_OPTIONS: Readonly<HeartbeatOptions> = Object.freeze({
  interval: 25_000,
  message: 'ping',
  mode: 'pong',
  pongTimeout: 10_000,
  responseMessage: 'pong',
})

export const DEFAULT_QUEUE_OPTIONS: Readonly<QueueOptions> = Object.freeze({
  maxBytes: MIB,
  maxMessages: 100,
  whenBackpressured: false,
  whenDisconnected: false,
})

export const DEFAULT_BACKPRESSURE_OPTIONS: Readonly<BackpressureOptions> = Object.freeze({
  highWaterMarkBytes: MIB,
  lowWaterMarkBytes: 256 * 1024,
})

export const DEFAULT_LEASE_OPTIONS: Readonly<LeaseOptions> = Object.freeze({
  interval: 20_000,
  timeout: 60_000,
})

export const DEFAULT_CONNECTION_LIMITS: Readonly<ConnectionLimits> = Object.freeze({
  maxClientsPerConnection: 64,
  maxEncodedMessageBytes: MIB,
})

export const DEFAULT_WORKER_RESOURCE_LIMITS: Readonly<WorkerResourceLimits> = Object.freeze({
  maxControlEnvelopeBytes: 2 * MIB,
  maxPorts: 256,
  unattachedPortTimeoutMs: 5_000,
})
