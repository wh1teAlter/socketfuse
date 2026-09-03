/** 验证物理连接控制器的连接、协议、重连、心跳和连接池行为。 */
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

  it('routes a socket constructor failure through the reconnect plan before retrying', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const urls: string[] = []
      const plans: { readonly reason: string, readonly terminal: boolean }[] = []
      const config = normalizeWebSocketOptions('wss://example.test/expired', {
        autoReconnect: { initialDelay: 1_000, jitter: 0 },
        id: 'constructor-reconnect-plan',
      })
      const controllerHolder: { current?: ConnectionController<SocketData, SocketData> } = {}
      const controller = new ConnectionController({
        config,
        onReconnectPlan: (plan) => {
          plans.push({ reason: plan.reason, terminal: plan.close.terminal })
          controllerHolder.current?.commitReconnectPlan(plan.id, { delay: 0, url: 'wss://example.test/fresh' })
          return true
        },
        socketFactory: (url) => {
          urls.push(url)
          if (urls.length === 1)
            throw new Error('constructor failed')
          return socket
        },
      })
      controllerHolder.current = controller
      controller.attach({ id: 'client' })
      const opening = controller.open()

      await vi.advanceTimersByTimeAsync(0)
      expect(plans).toEqual([{ reason: 'socket-error', terminal: false }])
      expect(urls).toEqual(['wss://example.test/expired', 'wss://example.test/fresh'])
      socket.open()
      await expect(opening).resolves.toMatchObject({ state: 'open' })
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('marks close notifications terminal only when no reconnect plan will run', async () => {
    const retryingSocket = new FakeSocket()
    const retryingClose: { readonly terminal: boolean, readonly willReconnect: boolean }[] = []
    const retryingConfig = normalizeWebSocketOptions('wss://example.test/socket', { id: 'retrying-close-terminal' })
    const retrying = new ConnectionController({
      config: retryingConfig,
      onReconnectPlan: () => true,
      socketFactory: () => retryingSocket,
    })
    retrying.attach({ id: 'client', onClose: event => retryingClose.push(event) })
    const retryingOpen = retrying.open()
    retryingSocket.open()
    await retryingOpen
    retryingSocket.close(1006)
    expect(retryingClose).toEqual([expect.objectContaining({ terminal: false, willReconnect: true })])
    retrying.dispose()

    const terminalSocket = new FakeSocket()
    const terminalClose: { readonly terminal: boolean, readonly willReconnect: boolean }[] = []
    const terminalConfig = normalizeWebSocketOptions('wss://example.test/socket', { autoReconnect: false, id: 'non-retrying-close-terminal' })
    const terminal = new ConnectionController({ config: terminalConfig, socketFactory: () => terminalSocket })
    terminal.attach({ id: 'client', onClose: event => terminalClose.push(event) })
    const terminalOpen = terminal.open()
    terminalSocket.open()
    await terminalOpen
    terminalSocket.close(1006)
    expect(terminalClose).toEqual([expect.objectContaining({ terminal: true, willReconnect: false })])
    terminal.dispose()
  })

  it('sends and consumes raw binary heartbeat payloads by wire bytes', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const messages: SocketData[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        heartbeat: {
          interval: 10,
          message: new Uint8Array([1]),
          pongTimeout: 20,
          responseMessage: new Uint8Array([2]),
        },
        id: 'raw-heartbeat',
      })
      const controller = new ConnectionController({ config, socketFactory: () => socket })
      controller.attach({ id: 'client', onMessage: data => messages.push(data) })
      const opening = controller.open()
      socket.open()
      await opening
      await vi.advanceTimersByTimeAsync(10)
      expect(socket.sent).toHaveLength(1)
      socket.message(new Uint8Array([2]).buffer)
      await vi.advanceTimersByTimeAsync(0)
      expect(messages).toEqual([])
      expect(socket.readyState).toBe(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('uses raw string ping and pong defaults without dispatching pong as data', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const messages: SocketData[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', { heartbeat: true, id: 'raw-string-heartbeat' })
      const controller = new ConnectionController({ config, socketFactory: () => socket })
      controller.attach({ id: 'client', onMessage: data => messages.push(data) })
      const opening = controller.open()
      socket.open()
      await opening
      await vi.advanceTimersByTimeAsync(25_000)
      expect(socket.sent).toEqual(['ping'])
      socket.message('pong')
      await vi.advanceTimersByTimeAsync(0)
      expect(messages).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('supports custom raw string ping and pong payloads', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const messages: SocketData[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        heartbeat: { interval: 10, message: 'custom-ping', pongTimeout: 20, responseMessage: 'custom-pong' },
        id: 'raw-custom-string-heartbeat',
      })
      const controller = new ConnectionController({ config, socketFactory: () => socket })
      controller.attach({ id: 'client', onMessage: data => messages.push(data) })
      const opening = controller.open()
      socket.open()
      await opening
      await vi.advanceTimersByTimeAsync(10)
      expect(socket.sent).toEqual(['custom-ping'])
      socket.message('custom-pong')
      await vi.advanceTimersByTimeAsync(0)
      expect(messages).toEqual([])
      expect(socket.readyState).toBe(1)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('lets a custom adapter own ping, pong and server-ping wire frames', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const messages: { messageType: string }[] = []
      const config = normalizeWebSocketOptions<{ messageType: string }, { messageType: string }>('wss://example.test/socket', {
        heartbeat: { interval: 10, pongTimeout: 20 },
        id: 'custom-heartbeat',
        protocol: {
          classify: data => data.messageType === 'pong'
            ? { type: 'pong' }
            : data.messageType === 'server-ping' ? { data, type: 'ping' } : { data, type: 'data' },
          createPing: () => ({ messageType: 'ping' }),
          createPong: () => ({ messageType: 'server-pong' }),
          decode: data => JSON.parse(String(data)) as { messageType: string },
          encode: data => JSON.stringify(data),
          id: 'custom-heartbeat',
          version: 1,
        },
        worker: () => null as unknown as SharedWorker,
      })
      const controller = new ConnectionController({ config, socketFactory: () => socket })
      controller.attach({ id: 'client', onMessage: data => messages.push(data) })
      const opening = controller.open()
      socket.open()
      await opening
      await vi.advanceTimersByTimeAsync(10)
      expect(socket.sent).toEqual(['{"messageType":"ping"}'])
      socket.message('{"messageType":"pong"}')
      await vi.advanceTimersByTimeAsync(0)
      socket.message('{"messageType":"server-ping"}')
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.sent).toEqual(['{"messageType":"ping"}', '{"messageType":"server-pong"}'])
      expect(messages).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('does not send a heartbeat resolved by an old socket attempt into a new socket', async () => {
    vi.useFakeTimers()
    try {
      const sockets = [new FakeSocket(), new FakeSocket()]
      let resolvePing: ((value: string) => void) | undefined
      const pendingPing = new Promise<string>((resolve) => {
        resolvePing = resolve
      })
      const config = normalizeWebSocketOptions<string, string>('wss://example.test/socket', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        heartbeat: { interval: 10 },
        id: 'stale-heartbeat-attempt',
        protocol: {
          classify: data => data === 'pong' ? { type: 'pong' } : { data, type: 'data' },
          createPing: () => pendingPing,
          decode: data => String(data),
          encode: data => data,
          id: 'stale-heartbeat-attempt',
          version: 1,
        },
        worker: () => null as unknown as SharedWorker,
      })
      let socketIndex = 0
      const controller = new ConnectionController({ config, socketFactory: () => sockets[socketIndex++] as FakeSocket })
      controller.attach({ id: 'client' })
      const opening = controller.open()
      sockets[0]?.open()
      await opening
      await vi.advanceTimersByTimeAsync(10)

      sockets[0]?.close(1006)
      await vi.advanceTimersByTimeAsync(0)
      sockets[1]?.open()
      resolvePing?.('late-ping')
      await vi.advanceTimersByTimeAsync(0)

      expect(sockets[0]?.sent).toEqual([])
      expect(sockets[1]?.sent).toEqual([])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('turns an explicit heartbeat timeout into the same reconnect plan path', async () => {
    vi.useFakeTimers()
    try {
      const socket = new FakeSocket()
      const plans: { readonly reason: string }[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        heartbeat: { interval: 10, pongTimeout: 5 },
        id: 'raw-heartbeat-timeout',
      })
      const controller = new ConnectionController({
        config,
        onReconnectPlan: (plan) => {
          plans.push(plan)
          return true
        },
        socketFactory: () => socket,
      })
      controller.attach({ id: 'client' })
      const opening = controller.open()
      socket.open()
      await opening

      await vi.advanceTimersByTimeAsync(15)

      expect(plans).toEqual([expect.objectContaining({ reason: 'heartbeat-timeout' })])
      expect(controller.state).toBe('reconnecting')
    }
    finally {
      vi.useRealTimers()
    }
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

  it('rejects an asynchronous send whose logical owner detached before encoding completed', async () => {
    let finishEncoding: ((value: string) => void) | undefined
    const encoded = new Promise<string>((resolve) => {
      finishEncoding = resolve
    })
    const config = normalizeWebSocketOptions<string, string>('wss://example.test/socket', {
      id: 'detached-send-owner',
      protocol: {
        classify: data => ({ data, type: 'data' }),
        decode: data => String(data),
        encode: () => encoded,
        id: 'detached-send-owner',
        version: 1,
      },
      queue: true,
      worker: () => null as unknown as SharedWorker,
    })
    const controller = new ConnectionController({ config, socketFactory: () => new FakeSocket() })
    controller.attach({ id: 'client' })
    const sending = controller.send('client', 'message')
    await Promise.resolve()
    controller.detach('client')
    finishEncoding?.('encoded')

    await expect(sending).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    expect(controller.queueMessages).toBe(0)
    controller.dispose()
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

  it('waits for an atomic reconnect plan and applies its URL and delay', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      const urls: string[] = []
      let plan: Parameters<NonNullable<ConstructorParameters<typeof ConnectionController>[0]['onReconnectPlan']>>[0] | undefined
      const config = normalizeWebSocketOptions('wss://example.test/old', {
        autoReconnect: { initialDelay: 1_000, jitter: 0 },
        id: 'reconnect-plan',
      })
      const controller = new ConnectionController({
        config,
        onReconnectPlan: (value) => {
          plan = value
          return true
        },
        socketFactory: (url) => {
          urls.push(url)
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })
      controller.attach({ id: 'client' })
      const opening = controller.open()
      sockets[0]?.open()
      await opening
      sockets[0]?.close(1006)

      expect(plan).toMatchObject({ attempt: 1, defaultDelay: 1_000, reason: 'socket-close' })
      expect(sockets).toHaveLength(1)
      const planId = plan?.id
      expect(planId).toBeTypeOf('string')
      controller.commitReconnectPlan(planId as string, { delay: 50, url: 'wss://example.test/new?token=secret' })
      await vi.advanceTimersByTimeAsync(49)
      expect(sockets).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(sockets).toHaveLength(2)
      expect(urls).toEqual(['wss://example.test/old', 'wss://example.test/new?token=secret'])
      expect(() => controller.commitReconnectPlan(planId as string)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('routes an explicit reconnect during backoff through the same zero-delay plan', async () => {
    vi.useFakeTimers()
    try {
      const sockets: FakeSocket[] = []
      const plans: { defaultDelay: number, reason: string }[] = []
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        autoReconnect: { initialDelay: 1_000, jitter: 0, retries: 1 },
        id: 'explicit-backoff-reconnect',
      })
      const controller = new ConnectionController({ config, onReconnectPlan: (plan) => {
        plans.push(plan)
        return false
      }, socketFactory: () => {
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
      expect(controller.state).toBe('reconnecting')
      expect(plans.at(-1)).toMatchObject({ defaultDelay: 0, reason: 'explicit' })
      await vi.advanceTimersByTimeAsync(0)
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

  it('replaces an automatic plan with the explicit plan requested by a close listener', async () => {
    const sockets: FakeSocket[] = []
    const plans: { id: string, reason: string }[] = []
    const config = normalizeWebSocketOptions('wss://example.test/socket', {
      autoReconnect: { initialDelay: 1_000, jitter: 0 },
      id: 'close-listener-reconnect',
    })
    const controller = new ConnectionController({
      config,
      onReconnectPlan: (plan) => {
        plans.push(plan)
        return true
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    controller.attach({
      id: 'client',
      onClose: () => {
        void controller.reconnect()
      },
    })
    const opening = controller.open()
    sockets[0]?.open()
    await opening

    sockets[0]?.close(1006)

    expect(plans).toEqual([expect.objectContaining({ reason: 'explicit' })])
    expect(sockets).toHaveLength(1)
    expect(controller.state).toBe('reconnecting')
    controller.detach('client')
    controller.dispose()
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

  it('keeps the active endpoint when a later pooled client supplies a different URL', async () => {
    const sockets: FakeSocket[] = []
    const config = normalizeWebSocketOptions('wss://example.test/initial', {
      autoReconnect: { initialDelay: 0, jitter: 0 },
      id: 'direct-initial-endpoint',
    })
    const first = new DirectTransport({
      clientId: 'first',
      config,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    first.attach({
      id: 'first',
      onBeforeReconnect: (plan) => {
        void first.completeReconnectPlan(plan.id, { delay: 0, url: 'wss://example.test/override' })
      },
    })
    await first.setReconnectHook(true)
    const opening = first.open()
    sockets[0]?.open()
    await opening
    sockets[0]?.close(1006)
    for (let attempt = 0; attempt < 20 && sockets.length < 2; attempt++)
      await new Promise(resolve => setTimeout(resolve, 0))
    expect(sockets).toHaveLength(2)

    const laterConfig = normalizeWebSocketOptions('wss://example.test/different', {
      autoReconnect: { initialDelay: 0, jitter: 0 },
      id: 'direct-initial-endpoint',
    })
    const second = new DirectTransport({ clientId: 'second', config: laterConfig, socketFactory: () => new FakeSocket() })
    expect(first.controller.endpointUrl).toBe('wss://example.test/override')
    second.dispose()
    first.dispose()
  })
})
