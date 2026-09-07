/**
 * 可由 E2E 主动终止的 custom SharedWorker。
 *
 * 测试控制消息只在本文件消费；正常业务消息全部交给 runtime，确保 restart 流程
 * 覆盖真实 Worker attach/restore 协议而不是 mock 页面状态。
 */
import { createSharedWebSocketRuntime } from 'socketfuse/worker'

/** E2E 用的最小 MessagePort 形状。 */
interface TestPort {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
  /** runtime 清理当前端口监听。 */
  removeEventListener: (type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void) => void
}

/** E2E 用的最小 SharedWorker global 形状。 */
interface TestWorkerScope {
  close: () => void
  onconnect: ((event: { readonly ports: readonly TestPort[] }) => void) | null
}

/** 页面 realm 中实际绑定的 SharedWorker 全局对象。 */
const scope = globalThis as unknown as TestWorkerScope
/** 由该 Worker 实例拥有的连接 runtime。 */
const runtime = createSharedWebSocketRuntime()
/** 将第一个连接端口交给 runtime，并监听仅供 E2E 的终止控制。 */
scope.onconnect = (event) => {
  const port = event.ports[0]
  if (port === undefined)
    return
  port.addEventListener('message', (message) => {
    const data = message.data
    if (typeof data === 'object' && data !== null && 'type' in data && data.type === '__socketfuse_test_terminate__')
      scope.close()
  })
  runtime.connect(port)
}
