import { createWebSocket, type WebSocketClient, type WwsError, WwsError as WwsErrorClass } from 'wws'
import { computed, onBeforeUnmount, shallowRef } from 'vue'

export interface PlaygroundMessage {
  readonly id: number
  readonly replayed: boolean
  readonly value: string
}

type PlaygroundClient = WebSocketClient<unknown, string, unknown>

function formatError(value: unknown): string {
  if (value instanceof WwsErrorClass)
    return `${value.code}: ${value.message}`
  if (value instanceof Error)
    return value.message
  return String(value)
}

function formatMessage(value: unknown): string {
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
  const url = shallowRef('ws://localhost:8787')
  let nextMessageId = 0

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
      const current = createWebSocket<unknown, string>(url.value, {
        fallback: fallback.value,
        id: connectionId.value,
        immediate: false,
        onError: (_client, value) => handleClientError(value),
        ...(replayWhileHidden.value ? { lifecycle: { restore: { replay: true } } } : {}),
        ...(simulateWorkerFailure.value ? { worker: () => { throw new Error('Simulated Worker construction failure') } } : {}),
      })
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
    sendMessage,
    simulateWorkerFailure,
    status,
    transport,
    url,
  }
}
