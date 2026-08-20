import type { WebSocketLike } from './socket'
import type { SocketData } from './types'
import { describe, expect, it } from 'vitest'
import { normalizeWebSocketOptions } from './config'
import { ConnectionController } from './connection-controller'
import { DirectTransport } from './direct-transport'

class FakeSocket implements WebSocketLike {
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  bufferedAmount = 0
  readyState = 0
  sent: SocketData[] = []
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener)
    this.listeners.set(type, current)
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
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

describe('connectionController', () => {
  it('opens, sends and broadcasts with a single physical socket', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'room' })
    const messages: SocketData[] = []
    const controller = new ConnectionController({ config, socketFactory: () => socket })
    controller.attach({ id: 'client-a', onMessage: data => messages.push(data) })
    const opening = controller.open()
    socket.open()
    await expect(opening).resolves.toMatchObject({ state: 'open', readyState: 1 })
    expect(await controller.send('client-a', 'hello')).toMatchObject({ status: 'accepted' })
    expect(socket.sent).toEqual(['hello'])
    socket.message('world')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(messages).toEqual(['world'])
  })

  it('queues while disconnected only when explicitly enabled', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'room', queue: true })
    const controller = new ConnectionController({ config, socketFactory: () => socket })
    controller.attach({ id: 'client-a' })
    await expect(controller.send('client-a', 'hello')).resolves.toMatchObject({ status: 'queued', position: 1 })
    const opening = controller.open()
    socket.open()
    await opening
    expect(socket.sent).toEqual(['hello'])
  })

  it('detaches owners and closes after the idle grace period', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'room', idleGraceMs: 10 })
    const controller = new ConnectionController({ config, socketFactory: () => socket })
    controller.attach({ id: 'client-a' })
    const opening = controller.open()
    socket.open()
    await opening
    controller.detach('client-a')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(socket.readyState).toBe(3)
  })

  it('rejects auth updates for protocols without auth support', async () => {
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'raw-auth' })
    const controller = new ConnectionController({ config, socketFactory: () => new FakeSocket() })

    await expect(controller.updateAuth({ token: 'secret' }, 1)).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED',
    })
  })

  it('reports a safe diagnostic snapshot without exposing endpoint paths', () => {
    const config = normalizeWebSocketOptions('wss://example.test/private-path', { id: 'diagnostic-room' })
    const controller = new ConnectionController({ config, socketFactory: () => new FakeSocket() })

    expect(controller.diagnostics('direct')).toMatchObject({
      attachedClientCount: 0,
      endpointOrigin: 'wss://example.test',
      idHash: expect.stringMatching(/^wws1-/),
      transport: 'direct',
    })
  })
})

describe('direct transport pool', () => {
  it('shares a controller within one JavaScript realm', async () => {
    const sockets: FakeSocket[] = []
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'direct-pool-test' })
    const socketFactory = (): FakeSocket => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    }
    const first = new DirectTransport({ clientId: 'a', config, socketFactory })
    const second = new DirectTransport({ clientId: 'b', config, socketFactory })
    first.attach({ id: 'a' })
    second.attach({ id: 'b' })
    const firstOpen = first.open()
    const secondOpen = second.open()
    sockets[0]?.open()
    await Promise.all([firstOpen, secondOpen])
    expect(sockets).toHaveLength(1)
    first.dispose()
    await expect(second.send('still-open')).resolves.toMatchObject({ status: 'accepted' })
    expect(sockets[0]?.sent).toEqual(['still-open'])
    second.dispose()
  })
})
