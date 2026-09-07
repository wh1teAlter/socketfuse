/** direct 仅提供同一页面内的原生 MessageChannel，连接语义由同一 runtime 实现。 */
import type { MessagePortLike } from '../runtime/control'
import { type ConnectionRuntime, createConnectionRuntime } from '../runtime/host'
import { SocketFuseError } from '../shared/errors'

/** 当前页面、当前包实例的惰性 runtime；不使用跨副本 globalThis 注册表。 */
let directRuntime: ConnectionRuntime | undefined

/**
 * 创建一次 direct 参与期端口；不在构造 client 时占用共享 id。
 * @param runtime 可选测试注入，正式页面使用模块内惰性共享实例。
 * @returns 经过真实结构化克隆的页面端口。
 * @throws ENVIRONMENT_UNSUPPORTED，缺 MessageChannel 或默认 WebSocket 时。
 */
export function createDirectPort(runtime?: ConnectionRuntime): MessagePortLike {
  if (typeof MessageChannel === 'undefined' || (runtime === undefined && typeof WebSocket === 'undefined'))
    throw new SocketFuseError('ENVIRONMENT_UNSUPPORTED')
  // 当前页面内唯一共享 runtime，语义与 Worker 引擎相同。
  const host = runtime ?? (directRuntime ??= createConnectionRuntime())
  // 原生 MessageChannel 保留异步派发和克隆边界。
  const channel = new MessageChannel()
  host.connect(channel.port2 as unknown as MessagePortLike)
  return channel.port1 as unknown as MessagePortLike
}
