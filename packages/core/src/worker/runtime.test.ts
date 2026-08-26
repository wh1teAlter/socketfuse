/** 验证 Worker runtime 的共享、attach 事务、回放 credit 与资源回收。 */
import { describe, expect, it, vi } from 'vitest'
import type { WebSocketLike } from '../transport/socket'
import type { SocketData } from '../shared/types'
import { createSharedWebSocketRuntime, type MessagePortLike } from './runtime'
import { SharedWorkerTransport } from '../transport/shared-worker'
import { normalizeWebSocketOptions } from '../config/normalize'
import { isClientControlMessage } from './control'

/** 双向连接的测试 MessagePort，模拟异步结构化克隆投递。 */
class LinkedPort implements MessagePortLike {
  /** 对端 port；仅测试拓扑使用，不属于产品 ownership。 */
  peer: LinkedPort | undefined
  /** 是否已关闭测试通道。 */
  closed = false
  /** 事件类型到监听器的测试映射。 */
  private readonly listeners = new Map<string, ((event: { readonly data: unknown }) => void)[]>()

  /** 注册测试消息监听器。 */
  addEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  /** 移除测试消息监听器。 */
  removeEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener))
  }

  /** 将消息异步转发到对端 port。 */
  postMessage(message: unknown): void {
    const peer = this.peer
    if (this.closed || peer === undefined)
      throw new Error('port closed')
    queueMicrotask(() => peer.emit('message', structuredClone(message)))
  }

  /** 标记 port 关闭。 */
  close(): void {
    this.closed = true
  }

  /** 测试 port 无需显式启动。 */
  start(): void {}

  /** 向当前 port 的监听器派发事件。 */
  private emit(type: string, data: unknown): void {
    if (this.closed)
      return
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data })
  }
}

/** 可手动触发 open/message/close 的测试 WebSocket。 */
class FakeSocket implements WebSocketLike {
  /** 浏览器 binaryType 的测试默认值。 */
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  /** 测试 bufferedAmount，默认没有积压。 */
  bufferedAmount = 0
  /** 可手动推进的 readyState。 */
  readyState = 0
  /** 记录发送顺序的测试数组。 */
  sent: SocketData[] = []
  /** socket 事件监听器。 */
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  /** 注册测试 socket 事件。 */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  /** 移除测试 socket 事件。 */
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener))
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

  /** 向 socket 监听器派发事件。 */
  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event)
  }
}

/** 创建一对互相连接的测试 MessagePort。 */
function createPortPair(): readonly [LinkedPort, LinkedPort] {
  const page = new LinkedPort()
  const worker = new LinkedPort()
  page.peer = worker
  worker.peer = page
  return [page, worker]
}

/** 等待异步 Worker 投递满足条件。 */
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
        idHash: expect.stringMatching(/^socketfuse1-/),
        logicalState: 'open',
        transport: 'shared-worker',
        workerInstanceHash: expect.stringMatching(/^socketfuse1-/),
      })
    }
    finally {
      runtime.dispose()
    }
  })

  it('reclaims unattached ports and applies static Worker limits', async () => {
    vi.useFakeTimers()
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxPorts: 1, unattachedPortTimeoutMs: 10 } })
    try {
      const first = createPortPair()
      const second = createPortPair()
      runtime.connect(first[1])
      runtime.connect(second[1])
      expect(second[1].closed).toBe(true)
      await vi.advanceTimersByTimeAsync(10)
      expect(first[1].closed).toBe(true)
      const third = createPortPair()
      runtime.connect(third[1])
      expect(third[1].closed).toBe(false)
    }
    finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })

  it('reclaims a closed logical client port immediately', async () => {
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxPorts: 1 } })
    try {
      const first = createPortPair()
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'port-reclaim' })
      runtime.connect(first[1])
      const firstTransport = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: first[0] } })
      firstTransport.attach({ id: 'first' })
      await waitFor(() => !first[1].closed)
      firstTransport.close()
      await new Promise(resolve => setTimeout(resolve, 0))

      const second = createPortPair()
      runtime.connect(second[1])
      expect(second[1].closed).toBe(false)
    }
    finally {
      runtime.dispose()
    }
  })

  it('reclaims a failed hello attach without consuming the Worker port capacity', async () => {
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxPorts: 2 } })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'attach-limit-room',
        limits: { maxClientsPerConnection: 1 },
      })
      const first = createPortPair()
      const rejected = createPortPair()
      runtime.connect(first[1])
      runtime.connect(rejected[1])
      const firstTransport = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: first[0] } })
      const rejectedTransport = new SharedWorkerTransport({ clientId: 'rejected', config, mode: 'inline', worker: { port: rejected[0] } })
      firstTransport.attach({ id: 'first' })
      await waitFor(() => !first[1].closed)
      rejectedTransport.attach({ id: 'rejected' })
      await expect(rejectedTransport.open()).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' })
      expect(rejected[1].closed).toBe(true)

      const replacement = createPortPair()
      runtime.connect(replacement[1])
      expect(replacement[1].closed).toBe(false)
    }
    finally {
      runtime.dispose()
    }
  })

  it('surfaces replay overflow and sends a receipt before page message dispatch', async () => {
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
        id: 'overflow',
        lifecycle: { restore: { maxBytes: 1, maxMessages: 1, replay: true } },
      })
      const overflows: unknown[] = []
      const deliveryOrder: string[] = []
      const post = pair[0].postMessage.bind(pair[0])
      pair[0].postMessage = (message) => {
        if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'receipt')
          deliveryOrder.push('receipt')
        post(message)
      }
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({
        id: 'a',
        onMessage: () => deliveryOrder.push('handler'),
        onOverflow: event => overflows.push(event),
      })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.message('delivered')
      await waitFor(() => deliveryOrder.length === 2)
      expect(deliveryOrder).toEqual(['receipt', 'handler'])
      transport.suspend()
      sockets[0]?.message('too-large')
      await new Promise(resolve => setTimeout(resolve, 0))
      transport.restore()
      await waitFor(() => overflows.length === 1)
      expect(overflows[0]).toMatchObject({ direction: 'replay', droppedMessages: 1 })
    }
    finally {
      runtime.dispose()
    }
  })

  it('rejects forged hello metadata and oversized binary controls without affecting peers', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      workerLimits: { maxControlEnvelopeBytes: 2_048 },
    })
    try {
      const healthy = createPortPair()
      const attacker = createPortPair()
      runtime.connect(healthy[1])
      runtime.connect(attacker[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'secure-room' })
      const transport = new SharedWorkerTransport({ clientId: 'healthy', config, mode: 'inline', worker: { port: healthy[0] } })
      transport.attach({ id: 'healthy' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      attacker[0].postMessage(new Map([['payload', new ArrayBuffer(4_096)]]))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(attacker[1].closed).toBe(true)

      const forged = {
        clientId: 'attacker',
        configCanonical: 'not-the-canonical-config',
        configFingerprint: config.configFingerprint,
        id: config.id,
        protocolMajor: 1,
        requestId: 'forged',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
      }
      expect(isClientControlMessage(forged)).toBe(true)
      const secondAttacker = createPortPair()
      const attackerResponses: unknown[] = []
      secondAttacker[0].addEventListener('message', event => attackerResponses.push(event.data))
      runtime.connect(secondAttacker[1])
      secondAttacker[0].postMessage(forged)
      await waitFor(() => attackerResponses.length === 1)
      expect(attackerResponses[0]).toMatchObject({
        error: { code: 'INVALID_CONTROL_MESSAGE', fatal: false },
        ok: false,
        requestId: 'forged',
        type: 'response',
      })
      expect(sockets).toHaveLength(1)
      await expect(transport.send('healthy')).resolves.toMatchObject({ status: 'accepted' })
    }
    finally {
      runtime.dispose()
    }
  })

  it('bounds an unreceipted client while continuing delivery to healthy ports', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const slowPair = createPortPair()
      const healthyPair = createPortPair()
      runtime.connect(slowPair[1])
      runtime.connect(healthyPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'credit-room' })
      const slowMessages: unknown[] = []
      slowPair[0].addEventListener('message', event => slowMessages.push(event.data))
      const healthyMessages: unknown[] = []
      const healthy = new SharedWorkerTransport({ clientId: 'healthy', config, mode: 'inline', worker: { port: healthyPair[0] } })
      healthy.attach({ id: 'healthy', onMessage: data => healthyMessages.push(data) })
      slowPair[0].postMessage({
        clientId: 'slow',
        configCanonical: config.configCanonical,
        configFingerprint: config.configFingerprint,
        id: config.id,
        protocolMajor: 1,
        requestId: 'slow-hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
      })
      const opening = healthy.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      for (let index = 0; index < 257; index++)
        sockets[0]?.message(`message-${index}`)
      await waitFor(() => healthyMessages.length === 257)
      await waitFor(() => slowMessages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message').length === 256)

      slowPair[0].postMessage({ deliveryId: 1, type: 'receipt' })
      await waitFor(() => slowMessages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow'))
      expect(slowMessages.find(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow')).toMatchObject({
        direction: 'inbound',
        droppedMessages: 1,
      })
    }
    finally {
      runtime.dispose()
    }
  })

  it('applies the same Worker delivery credit to replayed messages', async () => {
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
        id: 'replay-credit-room',
        lifecycle: { restore: { maxMessages: 256, replay: true } },
      })
      const messages: unknown[] = []
      pair[0].addEventListener('message', event => messages.push(event.data))
      pair[0].postMessage({
        clientId: 'slow',
        configCanonical: config.configCanonical,
        configFingerprint: config.configFingerprint,
        id: config.id,
        protocolMajor: 1,
        requestId: 'slow-hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
      })
      pair[0].postMessage({ requestId: 'open', type: 'open' })
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await new Promise(resolve => setTimeout(resolve, 0))

      for (let index = 0; index < 256; index++)
        sockets[0]?.message(`live-${index}`)
      await waitFor(() => messages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message').length === 256)

      pair[0].postMessage({ type: 'suspend' })
      await new Promise(resolve => setTimeout(resolve, 0))
      for (let index = 0; index < 2; index++)
        sockets[0]?.message(`replay-${index}`)
      await new Promise(resolve => setTimeout(resolve, 0))
      pair[0].postMessage({ type: 'restore' })
      await new Promise(resolve => setTimeout(resolve, 0))
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow'))
      expect(messages.find(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow')).toMatchObject({
        direction: 'replay',
        droppedMessages: 2,
      })
    }
    finally {
      runtime.dispose()
    }
  })
})
