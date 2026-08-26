/** 验证物理连接控制器的连接、协议、revision、重连和连接池行为。 */
import { describe, expect, it, vi } from 'vitest'
import type { WebSocketLike } from '../transport/socket'
import type { SocketData } from '../shared/types'
import { normalizeWebSocketOptions } from '../config/normalize'
import { DirectTransport } from '../transport/direct'
import { ConnectionController } from './controller'

/** 可手动触发生命周期的连接控制器测试 socket。 */
class FakeSocket implements WebSocketLike {
  /** 测试 binaryType。 */
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  /** 测试 bufferedAmount。 */
  bufferedAmount = 0
  /** 可手动推进的 readyState。 */
  readyState = 0
  /** 记录发送 payload。 */
  sent: SocketData[] = []
  /** socket 事件监听器。 */
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  /** 注册 socket 事件。 */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const current = this.listeners.get(type) ?? []
    current.push(listener)
    this.listeners.set(type, current)
  }

  /** 移除 socket 事件。 */
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item !== listener))
  }

  /** 记录发送 payload。 */
  send(data: SocketData): void {
    this.sent.push(data)
  }

  /** 关闭 socket 并派发 close。 */
  close(code = 1000): void {
    this.readyState = 3
    this.emit('close', { code, wasClean: code === 1000 })
  }

  /** 手动触发 open。 */
  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  /** 手动触发入站 message。 */
  message(data: SocketData): void {
    this.emit('message', { data })
  }

  /** 向监听器派发 socket 事件。 */
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
      idHash: expect.stringMatching(/^socketfuse1-/),
      transport: 'direct',
    })
  })

  it('keeps the attempt deadline through adapter handshake and rejects fatal frames', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'handshake-deadline',
        protocol: {
          capabilities: { auth: false, binary: false, heartbeat: false },
          classify: () => ({ type: 'fatal' }),
          decode: data => data,
          encode: data => String(data),
          id: 'fatal-protocol',
          readyWhen: 'adapter-frame',
          version: 1,
        },
        worker: () => null as unknown as SharedWorker,
      })
      const controller = new ConnectionController({ config, socketFactory: () => socket })
      controller.attach({ id: 'client' })
      const opening = controller.open()
      socket.open()
      await vi.advanceTimersByTimeAsync(1)
      socket.message('fatal')
      await expect(opening).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' })
      expect(socket.readyState).toBe(3)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('sends latest auth before becoming open for a socket-open protocol', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'auth-first-frame',
      protocol: { auth: { template: { token: '$auth.token' } }, type: 'json' },
    })
    const controller = new ConnectionController({ config, socketFactory: () => socket })
    controller.attach({ id: 'client' })
    await controller.updateAuth({ token: 'secret' }, 1)
    const opening = controller.open()
    socket.open()
    await opening
    expect(socket.sent).toEqual(['{"token":"secret"}'])
  })

  it('waits for asynchronous auth before accepting an adapter ready frame', async () => {
    let resolveAuth: ((value: string) => void) | undefined
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'adapter-frame-auth-order',
      protocol: {
        capabilities: { auth: true, binary: false, heartbeat: false },
        classify: data => data === 'ready' ? { type: 'ready' } : { data, type: 'data' },
        createAuth: () => new Promise<string>((resolve) => {
          resolveAuth = resolve
        }),
        decode: data => data,
        encode: data => data,
        id: 'async-auth',
        readyWhen: 'adapter-frame',
        version: 1,
      },
      worker: () => null as unknown as SharedWorker,
    })
    const controller = new ConnectionController({ config, socketFactory: () => socket })
    controller.attach({ id: 'client' })
    await controller.updateAuth('current-auth', 1)
    const opening = controller.open()
    socket.open()
    socket.message('ready')
    await Promise.resolve()
    expect(controller.state).toBe('handshaking')
    expect(socket.sent).toEqual([])
    resolveAuth?.('auth-frame')
    await expect(opening).resolves.toMatchObject({ state: 'open' })
    expect(socket.sent).toEqual(['auth-frame'])
  })

  it('restarts a connecting attempt when URL revision changes', async () => {
    const sockets: FakeSocket[] = []
    const config = normalizeWebSocketOptions('wss://example.test/old', { id: 'url-revision' })
    const controller = new ConnectionController({ config, socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    controller.attach({ id: 'client' })
    const opening = controller.open()
    await controller.updateUrl('wss://example.test/new', 1)
    expect(sockets[0]?.readyState).toBe(3)
    sockets[1]?.open()
    await opening
    expect(sockets).toHaveLength(2)
  })

  it('routes an explicit reconnect during backoff through connecting', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        autoReconnect: { initialDelay: 1_000, jitter: 0, retries: 1 },
        id: 'explicit-backoff-reconnect',
      })
      const controller = new ConnectionController({ config, socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      } })
      controller.attach({ id: 'client' })
      const opening = controller.open()
      sockets[0]?.open()
      await opening
      sockets[0]?.close(1006)
      expect(controller.state).toBe('reconnecting')

      await controller.reconnect()
      expect(controller.state).toBe('connecting')
      sockets[1]?.open()
      await Promise.resolve()
      expect(controller.state).toBe('open')
      expect(sockets).toHaveLength(2)
    }
    finally {
      vi.useRealTimers()
    }
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
