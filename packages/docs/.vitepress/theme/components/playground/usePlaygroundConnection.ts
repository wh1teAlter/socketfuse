import { createWebSocket, type JsonValue, type WebSocketClient, type WwsError, WwsError as WwsErrorClass } from 'wws'
import { computed, onBeforeUnmount, shallowRef } from 'vue'

export interface PlaygroundMessage {
  readonly id: number
  readonly replayed: boolean
  readonly type: 'binary' | 'text'
  readonly value: string
}

type BinaryMessageKind = 'array-buffer' | 'blob' | 'typed-array'
type PlaygroundAuth = { readonly token: string }
type PlaygroundClient = WebSocketClient<unknown, string | Blob | ArrayBuffer | Uint8Array, PlaygroundAuth>

interface WorkerTerminationPort {
  postMessage: (message: unknown) => void
}

interface WorkerTerminationHandle {
  readonly port: WorkerTerminationPort
}

function formatError(value: unknown): string {
  if (value instanceof WwsErrorClass)
    return `${value.code}: ${value.message}`
  if (value instanceof Error)
    return value.message
  return String(value)
}

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

export function usePlaygroundConnection() {
  const client = shallowRef<PlaygroundClient>()
  const clients = shallowRef('-')
  const connectionId = shallowRef('playground')
  const error = shallowRef('')
  const fallback = shallowRef<'direct' | 'error'>('direct')
  const isConnected = shallowRef(false)
  const messages = shallowRef<readonly PlaygroundMessage[]>([])
  const replayWhileHidden = shallowRef(false)
  const simulateWorkerFailure = shallowRef(false)
  const status = shallowRef('CLOSED')
  const transport = shallowRef('pending')
  const url = shallowRef('ws://localhost:8787/socket')
  let nextMessageId = 0
  let restartableWorker: WorkerTerminationHandle | undefined

  const messageCount = computed(() => messages.value.length)

  function refreshMetrics(current = client.value): void {
    if (current === undefined) {
      clients.value = '-'
      status.value = 'CLOSED'
      transport.value = 'pending'
      return
    }
    clients.value = String(current.diagnostics().attachedClientCount)
    status.value = current.status
    transport.value = current.transport
  }

  function appendMessage(value: unknown, replayed: boolean): void {
    messages.value = [...messages.value, {
      id: nextMessageId++,
      replayed,
      type: value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? 'binary' : 'text',
      value: formatMessage(value),
    }]
  }

  function clearMessages(): void {
    messages.value = []
    nextMessageId = 0
  }

  async function disposeCurrentClient(): Promise<void> {
    const current = client.value
    client.value = undefined
    isConnected.value = false
    if (current !== undefined)
      await current.dispose().catch(() => undefined)
  }

  function handleClientError(value: WwsError): void {
    error.value = `${value.code}: ${value.message}`
    refreshMetrics()
  }

  async function connect(): Promise<void> {
    await disposeCurrentClient()
    error.value = ''
    refreshMetrics()

    try {
      const parameters = new URLSearchParams(window.location.search)
      const useRestartableWorker = parameters.has('e2eWorkerRestart')
      const useRevisionReplay = parameters.has('e2eRevisionReplay')
      const current = (useRevisionReplay
        ? createWebSocket<JsonValue, JsonValue, PlaygroundAuth>(url.value, {
            fallback: fallback.value,
            id: connectionId.value,
            immediate: false,
            onError: (_client, value) => handleClientError(value),
            protocol: { auth: { template: { token: '$auth.token', type: 'auth' } }, type: 'json' },
            ...(replayWhileHidden.value ? { lifecycle: { restore: { replay: true } } } : {}),
            ...(useRestartableWorker
              ? { worker: () => {
                  const worker = new SharedWorker(new URL('./restartable-shared-worker.ts', import.meta.url), { type: 'module' })
                  restartableWorker = worker as unknown as WorkerTerminationHandle
                  return worker
                } }
              : {}),
          })
        : createWebSocket<unknown, string | Blob | ArrayBuffer | Uint8Array, unknown>(url.value, {
            fallback: fallback.value,
            id: connectionId.value,
            immediate: false,
            onError: (_client, value) => handleClientError(value),
            ...(replayWhileHidden.value ? { lifecycle: { restore: { replay: true } } } : {}),
            ...(useRestartableWorker
              ? {
                  worker: () => {
                    const worker = new SharedWorker(new URL('./restartable-shared-worker.ts', import.meta.url), { type: 'module' })
                    restartableWorker = worker as unknown as WorkerTerminationHandle
                    return worker
                  },
                }
              : {}),
            ...(simulateWorkerFailure.value
              ? { worker: () => { throw new Error('Simulated Worker construction failure') } }
              : {}),
          })) as unknown as PlaygroundClient
      current.onMessage(event => appendMessage(event.data, event.replayed))
      current.addEventListener('close', () => refreshMetrics(current))
      current.addEventListener('open', () => refreshMetrics(current))
      current.addEventListener('statechange', () => refreshMetrics(current))
      client.value = current
      await current.open()
      isConnected.value = true
      refreshMetrics(current)
    }
    catch (value) {
      error.value = formatError(value)
      isConnected.value = false
      refreshMetrics()
    }
  }

  async function disconnect(): Promise<void> {
    const current = client.value
    if (current === undefined)
      return
    await current.close().catch((value) => {
      error.value = formatError(value)
    })
    isConnected.value = false
    refreshMetrics(current)
  }

  async function sendMessage(payload: string): Promise<void> {
    const current = client.value
    if (current === undefined || payload.length === 0)
      return
    await current.sendMessage(payload).catch((value) => {
      error.value = formatError(value)
    })
  }

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

  function terminateWorkerForE2E(): void {
    restartableWorker?.port.postMessage({ type: '__wws_test_terminate__' })
  }

  async function applyRevisionsForE2E(nextUrl: string): Promise<void> {
    const current = client.value
    if (current === undefined)
      throw new Error('Connect before applying test revisions')
    await current.updateUrl(nextUrl, { revision: 1 })
    await current.updateAuth({ token: 'e2e-revision-auth' }, { revision: 1 })
  }

  if (typeof window !== 'undefined')
    Object.assign(window, {
      __wwsPlaygroundApplyRevisions: applyRevisionsForE2E,
      __wwsPlaygroundTerminateWorker: terminateWorkerForE2E,
    })

  function openAnotherTab(): void {
    window.open(window.location.href, '_blank', 'noopener')
  }

  onBeforeUnmount(() => {
    void disposeCurrentClient()
  })

  return {
    clearMessages,
    clients,
    connect,
    connectionId,
    disconnect,
    error,
    fallback,
    isConnected,
    messageCount,
    messages,
    openAnotherTab,
    replayWhileHidden,
    applyRevisionsForE2E,
    sendBinaryMessage,
    sendMessage,
    simulateWorkerFailure,
    status,
    terminateWorkerForE2E,
    transport,
    url,
  }
}
