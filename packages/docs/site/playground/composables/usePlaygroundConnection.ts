/**
 * Playground 连接状态与副作用 composable。
 *
 * 组件只通过 props/events 读写这些 refs；连接创建、生命周期监听、测试控制句柄和
 * 错误格式化集中在此处，避免展示组件持有 transport 状态。
 */
import { type ConnectionState, createWebSocket, type SocketFuseError, SocketFuseError as SocketFuseErrorClass, type WebSocketClient } from 'socketfuse'
import { computed, onBeforeUnmount, shallowRef } from 'vue'

/** Worker 诊断通过 MessagePort 异步返回时，演练场刷新指标的间隔，单位为毫秒。 */
const DIAGNOSTICS_REFRESH_INTERVAL_MS = 500

/** Playground 列表中展示的一条消息。 */
export interface PlaygroundMessage {
  /** 仅用于稳定渲染 key 的页面本地序号。 */
  readonly id: number
  /** 是否由 restore replay 投递。 */
  readonly replayed: boolean
  /** 展示层对 payload 的分类。 */
  readonly type: 'binary' | 'text'
  /** 已格式化且不承担协议语义的展示文本。 */
  readonly value: string
}

/** Playground 发送二进制样本的种类。 */
type BinaryMessageKind = 'array-buffer' | 'blob' | 'typed-array'
/** Playground 使用 raw 二进制 client，以公开 API 演示共享连接。 */
type PlaygroundClient = WebSocketClient<unknown, string | Blob | ArrayBuffer | Uint8Array>

/** E2E Worker 终止控制所需的最小端口能力。 */
interface WorkerTerminationPort {
  postMessage: (message: unknown) => void
}

/** 保存可终止 Worker 端口的页面句柄。 */
interface WorkerTerminationHandle {
  readonly port: WorkerTerminationPort
}

/** 将异常转换为 playground 可读文本，不暴露未脱敏内部详情。 */
function formatError(value: unknown): string {
  if (value instanceof SocketFuseErrorClass)
    return `${value.code}: ${value.message}`
  if (value instanceof Error)
    return value.message
  return String(value)
}

/** 将 raw/binary/JSON payload 转成稳定展示文本。 */
function formatMessage(value: unknown): string {
  if (value instanceof ArrayBuffer)
    return Array.from(new Uint8Array(value)).join(',')
  if (ArrayBuffer.isView(value))
    return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).join(',')
  try {
    return JSON.stringify(value)
  }
  catch {
    return String(value)
  }
}

/** 将物理连接状态映射为当前页面观测到的已打开 WebSocket 数量。 */
function physicalConnectionCount(physicalState: ConnectionState): '0' | '1' {
  return physicalState === 'open' ? '1' : '0'
}

/** 创建 playground 页面使用的连接状态、操作和测试钩子。 */
export function usePlaygroundConnection() {
  const client = shallowRef<PlaygroundClient>()
  const connectionId = shallowRef('playground')
  const error = shallowRef('')
  const fallback = shallowRef<'direct' | 'error'>('direct')
  const isConnected = shallowRef(false)
  const messages = shallowRef<readonly PlaygroundMessage[]>([])
  /** 当前页面 keyed handler 的实际执行次数。 */
  const exclusiveMessageCount = shallowRef(0)
  /** Worker 控制帧确认的演示 key 持有状态。 */
  const exclusiveKeyHeld = shallowRef(false)
  /** 当前页面成功运行的重连 hook 次数。 */
  const reconnectHookCount = shallowRef(0)
  /** 当前页面观测到的已打开物理 WebSocket 数量。 */
  const physicalConnections = shallowRef('-')
  const replayWhileHidden = shallowRef(false)
  /** 当前 SharedWorker 物理连接附着的逻辑页面 client 数量。 */
  const sharedClients = shallowRef('-')
  const simulateWorkerFailure = shallowRef(false)
  const status = shallowRef('CLOSED')
  const transport = shallowRef('pending')
  const url = shallowRef('ws://127.0.0.1:8787/socket')
  /** 仅在当前页面参与连接期间运行的 Worker diagnostics 刷新 timer。 */
  let metricsRefreshTimer: ReturnType<typeof globalThis.setInterval> | undefined
  let nextMessageId = 0
  let restartableWorker: WorkerTerminationHandle | undefined

  const messageCount = computed(() => messages.value.length)

  /** 清空已脱离页面不能再可靠观测的连接指标，并保留本地 client 状态。 */
  function clearMetrics(current: PlaygroundClient | undefined = client.value): void {
    physicalConnections.value = '-'
    sharedClients.value = '-'
    status.value = current?.status ?? 'CLOSED'
    transport.value = current?.transport ?? 'pending'
  }

  /** 从当前 client 快照刷新页面指标。 */
  function refreshMetrics(current = client.value): void {
    if (current === undefined || !isConnected.value) {
      clearMetrics(current)
      return
    }
    const diagnostics = current.diagnostics()
    physicalConnections.value = physicalConnectionCount(diagnostics.physicalState)
    sharedClients.value = String(diagnostics.attachedClientCount)
    status.value = current.status
    transport.value = current.transport
  }

  /** 停止当前页面对异步 Worker diagnostics 的低频刷新。 */
  function stopMetricsRefresh(): void {
    if (metricsRefreshTimer !== undefined)
      globalThis.clearInterval(metricsRefreshTimer)
    metricsRefreshTimer = undefined
  }

  /** 在页面参与连接期间刷新 Worker 侧指标，避免首次缓存快照长期停留在初始值。 */
  function startMetricsRefresh(current: PlaygroundClient): void {
    stopMetricsRefresh()
    refreshMetrics(current)
    metricsRefreshTimer = globalThis.setInterval(() => {
      if (current !== client.value || !isConnected.value) {
        stopMetricsRefresh()
        return
      }
      refreshMetrics(current)
    }, DIAGNOSTICS_REFRESH_INTERVAL_MS)
  }

  /** 追加一条已格式化的消息并分配页面内序号。 */
  function appendMessage(value: unknown, replayed: boolean): void {
    messages.value = [...messages.value, {
      id: nextMessageId++,
      replayed,
      type: value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? 'binary' : 'text',
      value: formatMessage(value),
    }]
  }

  /** 清空消息列表并重置展示序号。 */
  function clearMessages(): void {
    messages.value = []
    nextMessageId = 0
  }

  /** 释放旧 client，保证重新连接不会残留页面 port。 */
  async function disposeCurrentClient(): Promise<void> {
    const current = client.value
    stopMetricsRefresh()
    client.value = undefined
    isConnected.value = false
    exclusiveKeyHeld.value = false
    if (current !== undefined)
      await current.dispose().catch(() => undefined)
    clearMetrics()
  }

  /** 记录已脱敏的 client 错误并同步指标。 */
  function handleClientError(value: SocketFuseError): void {
    error.value = `${value.code}: ${value.message}`
    refreshMetrics()
  }

  /** 根据当前表单创建并打开 playground client。 */
  async function connect(): Promise<void> {
    await disposeCurrentClient()
    error.value = ''
    exclusiveMessageCount.value = 0
    reconnectHookCount.value = 0
    refreshMetrics()

    try {
      const parameters = new URLSearchParams(window.location.search)
      const useRestartableWorker = parameters.has('e2eWorkerRestart')
      /** 只供跨浏览器验收缩短应用层 heartbeat 周期。 */
      const useHeartbeat = parameters.has('e2eHeartbeat')
      const current = createWebSocket<unknown, string | Blob | ArrayBuffer | Uint8Array>(url.value, {
        fallback: fallback.value,
        ...(useHeartbeat ? { heartbeat: { interval: 100, pongTimeout: 1_000 } } : {}),
        id: connectionId.value,
        immediate: false,
        onError: (_client, value) => handleClientError(value),
        ...(replayWhileHidden.value ? { lifecycle: { restore: { replay: true } } } : {}),
        ...(useRestartableWorker
          ? {
              worker: () => {
                const worker = new SharedWorker(new URL('../workers/restartable-shared-worker.ts', import.meta.url), { type: 'module' })
                restartableWorker = worker as unknown as WorkerTerminationHandle
                return worker
              },
            }
          : {}),
        ...(simulateWorkerFailure.value
          ? { worker: () => { throw new Error('Simulated Worker construction failure') } }
          : {}),
      }) as PlaygroundClient
      current.onMessage(event => appendMessage(event.data, event.replayed))
      current.onMessage(() => {
        exclusiveMessageCount.value++
      }, { key: 'playground:single-execution' })
      current.onBeforeReconnect((context) => {
        context.setOptions({ url: url.value })
        context.setDelay(0)
        reconnectHookCount.value++
      })
      current.addEventListener('keychange', () => {
        exclusiveKeyHeld.value = current.holdsKey('playground:single-execution')
      })
      current.addEventListener('close', () => refreshMetrics(current))
      current.addEventListener('open', () => refreshMetrics(current))
      current.addEventListener('statechange', () => refreshMetrics(current))
      client.value = current
      await current.open()
      isConnected.value = true
      startMetricsRefresh(current)
    }
    catch (value) {
      stopMetricsRefresh()
      error.value = formatError(value)
      isConnected.value = false
      clearMetrics()
    }
  }

  /** 关闭当前 client 并刷新页面指标。 */
  async function disconnect(): Promise<void> {
    const current = client.value
    if (current === undefined)
      return
    stopMetricsRefresh()
    await current.close().catch((value) => {
      error.value = formatError(value)
    })
    isConnected.value = false
    clearMetrics(current)
  }

  /** 发送文本样本；失败只更新展示错误，不抛出到模板事件。 */
  async function sendMessage(payload: string): Promise<void> {
    const current = client.value
    if (current === undefined || payload.length === 0)
      return
    await current.sendMessage(payload).catch((value) => {
      error.value = formatError(value)
    })
  }

  /** 发送指定类型的固定二进制样本。 */
  async function sendBinaryMessage(kind: BinaryMessageKind): Promise<void> {
    const current = client.value
    if (current === undefined)
      return
    const data = kind === 'array-buffer'
      ? new Uint8Array([4, 5, 6]).buffer
      : kind === 'blob'
        ? new Blob([new Uint8Array([7, 8, 9])])
        : new Uint8Array([1, 2, 3])
    await current.sendMessage(data).catch((value) => {
      error.value = formatError(value)
    })
  }

  /** 通过测试 worker 控制端口触发 Worker 终止。 */
  function terminateWorkerForE2E(): void {
    restartableWorker?.port.postMessage({ type: '__socketfuse_test_terminate__' })
  }

  if (typeof window !== 'undefined')
    Object.assign(window, {
      __socketfusePlaygroundTerminateWorker: terminateWorkerForE2E,
    })

  /** 打开同源 playground 新标签页以观察连接共享。 */
  function openAnotherTab(): void {
    window.open(window.location.href, '_blank', 'noopener')
  }

  onBeforeUnmount(() => {
    void disposeCurrentClient()
  })

  return {
    clearMessages,
    connect,
    connectionId,
    disconnect,
    error,
    exclusiveKeyHeld,
    exclusiveMessageCount,
    fallback,
    isConnected,
    messageCount,
    messages,
    openAnotherTab,
    physicalConnections,
    reconnectHookCount,
    replayWhileHidden,
    sendBinaryMessage,
    sendMessage,
    sharedClients,
    simulateWorkerFailure,
    status,
    terminateWorkerForE2E,
    transport,
    url,
  }
}
