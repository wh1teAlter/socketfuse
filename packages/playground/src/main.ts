import type { WebSocketClient, WwsError, WwsMessageEvent } from 'wws'
import { createWebSocket, WwsError as WwsErrorClass } from 'wws'
import './style.css'

const app: HTMLElement | null = document.querySelector<HTMLElement>('#app')

if (app !== null) {
  app.innerHTML = `
    <header class="topbar">
      <div>
        <p class="eyebrow">wws playground</p>
        <h1>Shared WebSocket console</h1>
      </div>
      <button id="new-tab" type="button">Open another tab</button>
    </header>
    <section class="toolbar" aria-label="Connection controls">
      <label>URL <input id="url" value="ws://localhost:8787" /></label>
      <label>Connection id <input id="connection-id" value="playground" /></label>
      <label class="toggle"><input id="replay" type="checkbox" /> Replay while hidden</label>
      <label class="toggle"><input id="worker-failure" type="checkbox" /> Simulate Worker init failure</label>
      <label>Fallback
        <select id="fallback">
          <option value="direct">direct</option>
          <option value="error">error</option>
        </select>
      </label>
      <button id="connect" type="button">Connect</button>
      <button id="disconnect" type="button" disabled>Disconnect</button>
    </section>
    <section class="metrics" aria-live="polite">
      <div><span>Transport</span><strong id="transport">pending</strong></div>
      <div><span>Status</span><strong id="status">CLOSED</strong></div>
      <div><span>Physical clients</span><strong id="clients">-</strong></div>
      <div><span>Messages</span><strong id="message-count">0</strong></div>
    </section>
    <section class="console">
      <div class="console-head"><h2>Messages</h2><button id="clear" type="button">Clear</button></div>
      <ol id="messages" aria-live="polite"></ol>
    </section>
    <form id="send-form" class="send-form">
      <input id="payload" placeholder="Message payload" autocomplete="off" />
      <button type="submit">Send</button>
    </form>
    <p id="error" class="error" role="status"></p>
  `

  const urlInput = get<HTMLInputElement>('url')
  const idInput = get<HTMLInputElement>('connection-id')
  const replayInput = get<HTMLInputElement>('replay')
  const workerFailureInput = get<HTMLInputElement>('worker-failure')
  const fallbackInput = get<HTMLSelectElement>('fallback')
  const connectButton = get<HTMLButtonElement>('connect')
  const disconnectButton = get<HTMLButtonElement>('disconnect')
  const transport = get<HTMLElement>('transport')
  const status = get<HTMLElement>('status')
  const clients = get<HTMLElement>('clients')
  const messageCount = get<HTMLElement>('message-count')
  const messages = get<HTMLOListElement>('messages')
  const error = get<HTMLElement>('error')
  let client: WebSocketClient<unknown, unknown, unknown> | undefined
  let count = 0

  const update = (): void => {
    if (client === undefined)
      return
    transport.textContent = client.transport
    status.textContent = client.status
    clients.textContent = String(client.diagnostics().attachedClientCount)
  }

  const addMessage = (value: unknown, replayed: boolean): void => {
    count++
    messageCount.textContent = String(count)
    const item = document.createElement('li')
    item.textContent = `${replayed ? '[replayed] ' : ''}${JSON.stringify(value)}`
    messages.append(item)
  }

  connectButton.addEventListener('click', async () => {
    await client?.dispose()
    client = undefined
    transport.textContent = 'pending'
    status.textContent = 'CLOSED'
    clients.textContent = '-'
    error.textContent = ''
    const createOptions = {
      fallback: fallbackInput.value as 'direct' | 'error',
      id: idInput.value,
      immediate: false,
      onError: (_client: WebSocketClient<unknown, unknown, unknown>, value: WwsError) => {
        error.textContent = `${value.code}: ${value.message}`
        update()
      },
      ...(replayInput.checked ? { lifecycle: { restore: { replay: true } } } : {}),
      ...(workerFailureInput.checked ? { worker: () => { throw new Error('Simulated Worker construction failure') } } : {}),
    }
    try {
      client = createWebSocket(urlInput.value, createOptions)
    }
    catch (value) {
      error.textContent = value instanceof WwsErrorClass ? `${value.code}: ${value.message}` : String(value)
      return
    }
    client.onMessage((event: WwsMessageEvent<unknown>) => addMessage(event.data, event.replayed))
    client.addEventListener('statechange', update)
    client.addEventListener('open', update)
    await client.open().catch((value: unknown) => {
      error.textContent = value instanceof WwsErrorClass ? `${value.code}: ${value.message}` : String(value)
    })
    connectButton.disabled = true
    disconnectButton.disabled = false
    update()
  })

  disconnectButton.addEventListener('click', async () => {
    await client?.close()
    connectButton.disabled = false
    disconnectButton.disabled = true
    update()
  })

  get<HTMLButtonElement>('new-tab').addEventListener('click', () => {
    window.open(window.location.href, '_blank', 'noopener')
  })
  get<HTMLButtonElement>('clear').addEventListener('click', () => {
    messages.replaceChildren()
    count = 0
    messageCount.textContent = '0'
  })
  get<HTMLFormElement>('send-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const payload = get<HTMLInputElement>('payload')
    if (client === undefined || payload.value.length === 0)
      return
    await client.sendMessage(payload.value).catch((value: unknown) => {
      error.textContent = value instanceof Error ? value.message : String(value)
    })
    payload.value = ''
  })
}

function get<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (element === null)
    throw new Error(`Missing playground element: ${id}`)
  return element as T
}
