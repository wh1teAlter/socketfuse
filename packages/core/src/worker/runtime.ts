/** SharedWorker 启动适配；连接池、协议处理和端口生命周期全部由通用 runtime 拥有。 */
import type { MessagePortLike } from '../runtime/control'
import { type ConnectionRuntime, type ConnectionRuntimeOptions, createConnectionRuntime } from '../runtime/host'

/** 自定义 Worker runtime 的公开静态配置。 */
export type SharedWebSocketRuntimeOptions = ConnectionRuntimeOptions
/** 已创建 Worker 的端口接入与释放能力。 */
export type SharedWebSocketRuntime = ConnectionRuntime
/** 自定义 SharedWorker global scope 的最小能力面。 */
export interface SharedWorkerGlobalLike {
  /** 浏览器提供的新页面连接入口。 */
  onconnect: ((event: { readonly ports: readonly MessagePortLike[] }) => void) | null
}

/**
 * 创建未接入端口的 SharedWorker runtime。
 * @param options 静态协议/扩展注册、资源上限和可注入平台能力。
 * @returns 同一实例内按 id/config 共享连接的运行时。
 * @throws INVALID_OPTIONS，静态配置或重复协议身份无效时。
 */
export function createSharedWebSocketRuntime(options: SharedWebSocketRuntimeOptions = {}): SharedWebSocketRuntime {
  return createConnectionRuntime(options)
}

/**
 * 创建 runtime 并安装 SharedWorker 的 onconnect。
 * @param options Worker 静态配置，页面不可修改。
 * @param scope 可选的注入 global scope；省略时使用当前 Worker realm。
 * @returns 已安装接入入口的运行时；dispose 终止端口和连接所有权。
 * @throws INVALID_OPTIONS，静态配置无效时。
 */
export function exposeSharedWebSocketWorker(options: SharedWebSocketRuntimeOptions = {}, scope?: SharedWorkerGlobalLike): SharedWebSocketRuntime {
  // 只在显式 expose 时访问 Worker 全局能力。
  const target = scope ?? globalThis as unknown as SharedWorkerGlobalLike
  // 此 Worker 启动实例唯一的连接运行时。
  const runtime = createConnectionRuntime(options)
  target.onconnect = (event): void => {
    for (const port of event.ports)
      runtime.connect(port)
  }
  return runtime
}
