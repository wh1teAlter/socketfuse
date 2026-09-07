/**
 * 演示连接作用域扩展的 custom SharedWorker。
 *
 * 扩展演示有界入站去重、应用收到确认，以及计数或豁免重连指令。
 * 每个物理帧只执行一次连接协议效果，所有标签页只接收业务投影。
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
      onFrame: (frame) => {
        // 演示协议只解释约定的文本控制消息。
        const data = frame.data
        if (data === 'reconnect-counted' || data === 'reconnect-free')
          return { delivery: { type: 'consume' }, reconnect: { countAsRetry: data === 'reconnect-counted' } }
        if (typeof data === 'string' && data.startsWith('ack-received:'))
          return { delivery: { type: 'consume' } }
        if (typeof data === 'string' && data.startsWith('ack-required:'))
          return { delivery: { type: 'broadcast', data }, reply: data.replace('ack-required:', 'ack-received:') }
        // 二进制及其他值保持普通业务派发。
        const text = typeof data === 'string' ? data : undefined
        // 只对约定前缀去重，避免影响演练场其他消息演示。
        if (text === undefined || !text.startsWith('dedupe:'))
          return { delivery: { type: 'broadcast', data } }
        if (seen.has(text))
          return { delivery: { type: 'consume' } }
        // 演示状态也必须有界，生产应用按自己的重放窗口定义幂等范围。
        if (seen.size >= 256)
          seen.delete(seen.values().next().value!)
        seen.add(text)
        return { delivery: { type: 'broadcast', data } }
      },
      onSocketOpen: () => seen.clear(),
    }
  },
})

/** 当前 custom Worker 的端口接入能力。 */
const scope = globalThis as unknown as WorkerScope
scope.onconnect = (event) => {
  const port = event.ports[0]
  if (port !== undefined)
    runtime.connect(port)
}
