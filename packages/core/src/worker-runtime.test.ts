import { describe, expect, it } from 'vitest'
import type { WebSocketLike } from './socket'
import type { SocketData } from './types'
import { createSharedWebSocketRuntime, type MessagePortLike } from './worker-runtime'
import { SharedWorkerTransport } from './shared-worker-transport'
import { normalizeWebSocketOptions } from './config'

class LinkedPort implements MessagePortLike {
  peer: LinkedPort | undefined
  closed = false
  private readonly listeners = new Map<string, ((event: { readonly data: unknown }) => void)[]>()

  addEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  removeEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener))
  }

  postMessage(message: unknown): void {
    const peer = this.peer
    if (this.closed || peer === undefined)
      throw new Error('port closed')
    queueMicrotask(() => peer.emit('message', structuredClone(message)))
  }

  close(): void {
    this.closed = true
  }

  start(): void {}

  private emit(type: string, data: unknown): void {
    if (this.closed)
      return
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data })
  }
}

class FakeSocket implements WebSocketLike {
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  bufferedAmount = 0
  readyState = 0
  sent: SocketData[] = []
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener))
  }

  send(data: SocketData): void {
    this.sent.push(data)
  }

  close(code = 1000): void {
    this.readyState = 3
    this.emit('close', { code, wasClean: code === 1000 })
  }

  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  message(data: SocketData): void {
    this.emit('message', { data })
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event)
  }
}

function createPortPair(): readonly [LinkedPort, LinkedPort] {
  const page = new LinkedPort()
  const worker = new LinkedPort()
  page.peer = worker
  worker.peer = page
  return [page, worker]
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check())
      return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition not reached')
}

describe('shared worker runtime', () => {
  it('shares one physical socket and broadcasts to every attached client', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const firstMessages: unknown[] = []
      const secondMessages: unknown[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'shared' })
      const first = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'b', config, mode: 'inline', worker: { port: secondPair[0] } })
      first.attach({ id: 'a', onMessage: data => firstMessages.push(data) })
      second.attach({ id: 'b', onMessage: data => secondMessages.push(data) })
      const firstOpen = first.open()
      const secondOpen = second.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await Promise.all([firstOpen, secondOpen])
      sockets[0]?.message('broadcast')
      await waitFor(() => firstMessages.length === 1 && secondMessages.length === 1)
      expect(sockets).toHaveLength(1)
      expect(firstMessages).toEqual(['broadcast'])
      expect(secondMessages).toEqual(['broadcast'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('rejects a later client with a conflicting shared config', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const firstConfig = normalizeWebSocketOptions('wss://example.test/socket', { id: 'shared' })
      const secondConfig = normalizeWebSocketOptions('wss://example.test/socket', { binaryType: 'blob', id: 'shared' })
      const first = new SharedWorkerTransport({ clientId: 'a', config: firstConfig, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'b', config: secondConfig, mode: 'inline', worker: { port: secondPair[0] } })
      first.attach({ id: 'a' })
      second.attach({ id: 'b' })
      const opening = first.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      await expect(second.open()).rejects.toMatchObject({ code: 'CONNECTION_CONFIG_CONFLICT' })
      expect(sockets).toHaveLength(1)
    }
    finally {
      runtime.dispose()
    }
  })

  it('pauses a client and replays bounded messages in arrival order', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'replay-test',
        lifecycle: { restore: { maxBytes: 64, maxMessages: 2, replay: true } },
      })
      const received: { data: unknown, replayed: boolean }[] = []
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'a', onMessage: (data, _receivedAt, replayed) => received.push({ data, replayed: replayed ?? false }) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      transport.suspend()
      sockets[0]?.message('one')
      sockets[0]?.message('two')
      sockets[0]?.message('three')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(received).toEqual([])
      transport.restore()
      await waitFor(() => received.length === 2)
      expect(received).toEqual([{ data: 'two', replayed: true }, { data: 'three', replayed: true }])
    }
    finally {
      runtime.dispose()
    }
  })

  it('refreshes diagnostics from the Worker-owned controller', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/private-path', { id: 'diagnostic-room' })
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'a' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      transport.diagnostics()
      await waitFor(() => transport.diagnostics().attachedClientCount === 1)
      expect(transport.diagnostics()).toMatchObject({
        endpointOrigin: 'wss://example.test',
        idHash: expect.stringMatching(/^wws1-/),
        logicalState: 'open',
        transport: 'shared-worker',
        workerInstanceHash: expect.stringMatching(/^wws1-/),
      })
    }
    finally {
      runtime.dispose()
    }
  })
})
