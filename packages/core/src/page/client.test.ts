import { describe, expect, it } from 'vitest'
import type { WebSocketLike } from '../transport/socket'
import type { SocketData } from '../shared/types'
import { normalizeWebSocketOptions } from '../config/normalize'
import { DirectTransport } from '../transport/direct'
import { PageWebSocketClient } from './client'

class FakeSocket implements WebSocketLike {
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  bufferedAmount = 0
  readyState = 0
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
    void data
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

describe('pageWebSocketClient', () => {
  it('keeps a stable client object and isolates dynamic handlers', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-test' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-test' }, 'client')
    const received: unknown[] = []
    const removeFirst = client.onMessage(event => received.push(event.data))
    client.onMessage(event => received.push(`second:${event.data}`))
    const opening = client.open()
    socket.open()
    await opening
    socket.message('one')
    await new Promise(resolve => setTimeout(resolve, 0))
    removeFirst()
    socket.message('two')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(client.data).toBe('two')
    expect(received).toEqual(['one', 'second:one', 'second:two'])
    await client.close()
    expect(client.status).toBe('CLOSED')
    await client.dispose()
    expect(() => client.onMessage(() => undefined)).toThrowError(/disposed/i)
  })

  it('treats repeated registration of the same handler as independent', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-duplicate-handler' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-duplicate-handler' }, 'client')
    const received: unknown[] = []
    const handler = (event: { readonly data: unknown }): void => {
      received.push(event.data)
    }
    const removeFirst = client.onMessage(handler)
    client.onMessage(handler)
    const opening = client.open()
    socket.open()
    await opening
    socket.message('one')
    await new Promise(resolve => setTimeout(resolve, 0))
    removeFirst()
    socket.message('two')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(received).toEqual(['one', 'one', 'two'])
    await client.dispose()
  })

  it('updates data and runs onMessage handlers before EventTarget listeners', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-message-order' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-message-order' }, 'client')
    const calls: string[] = []
    client.onMessage(() => calls.push(`handler:${client.data}`))
    client.onMessage(() => {
      calls.push('throwing-handler')
      throw new Error('handler secret')
    })
    client.addEventListener('message', () => calls.push(`event:${client.data}`))
    const opening = client.open()
    socket.open()
    await opening
    socket.message('ordered')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(calls).toEqual(['handler:ordered', 'throwing-handler', 'event:ordered'])
    await client.dispose()
  })

  it('sanitizes rejected direct-path promises before they reach callers', async () => {
    const config = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'page-client-safe-promise',
      protocol: {
        capabilities: { auth: false, binary: false, heartbeat: false },
        classify: data => ({ data, type: 'data' }),
        decode: data => data,
        encode: () => {
          throw new Error('adapter-secret')
        },
        id: 'secret-encoder',
        version: 1,
      },
      worker: () => null as unknown as SharedWorker,
    })
    const socket = new FakeSocket()
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-safe-promise', protocol: config.adapter }, 'client')
    const opening = client.open()
    socket.open()
    await opening

    await expect(client.sendMessage('message')).rejects.toMatchObject({
      cause: undefined,
      code: 'ENCODE_FAILED',
      message: 'Protocol message encoding failed',
    })
    await client.dispose()
  })
})
