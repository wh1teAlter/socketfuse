/**
 * @wws/core 的内部公共实现入口。
 *
 * 该入口供公开 facade、inline Worker 和测试 workspace 复用；发布包通过 facade
 * 暴露受控的子集，避免页面直接依赖内部模块路径。
 */
export * from './config/normalize'
export * from './connection/backpressure'
export * from './connection/controller'
export * from './connection/heartbeat'
export * from './connection/queue'
export * from './connection/reconnect'
export * from './connection/revision'
export * from './connection/state'
export * from './page/client'
export * from './protocol/adapter'
export * from './shared/constants'
export * from './shared/errors'
export * from './shared/structured'
export * from './shared/types'
export * from './transport/direct'
export * from './transport/shared-worker'
export * from './transport/socket'
export * from './worker/control'
export * from './worker/runtime'

/** 当前 core 实现版本，供构建和诊断关联使用。 */
export const CORE_VERSION = '0.0.0' as const
