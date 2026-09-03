/**
 * 演示连接作用域扩展的 custom SharedWorker。
 *
 * 扩展只做入站去重：相同 payload 文本在共享连接上只派发一次，所有标签页同时生效。
 * 这里刻意保持最小实现，用于人工与 E2E 验证「Worker 内处理一次」的语义。
 */
import { createSharedWebSocketRuntime } from 'socketfuse/worker'

/** E2E 用的最小 SharedWorker global 形状。 */
interface WorkerScope {
  onconnect: ((event: { readonly ports: readonly never[] }) => void) | null
}

/** 当前 Worker 实例拥有的连接 runtime。 */
const runtime = createSharedWebSocketRuntime({
  createExtension: () => {
    /** 本条共享连接已派发过的 payload 文本；Worker 回收后自然重建。 */
    const seen = new Set<string>()
    return {
      filterInbound: (data) => {
        const text = typeof data === 'string' ? data : undefined
        // 只对约定前缀去重，避免影响演练场其他消息演示。
        if (text === undefined || !text.startsWith('dedupe:'))
          return 'deliver'
        if (seen.has(text))
          return 'drop'
        seen.add(text)
        return 'deliver'
      },
      onSocketOpen: () => seen.clear(),
    }
  },
})

const scope = globalThis as unknown as WorkerScope
scope.onconnect = (event) => {
  const port = event.ports[0]
  if (port !== undefined)
    runtime.connect(port)
}
