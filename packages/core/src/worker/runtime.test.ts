/** 验证 Worker runtime 的共享、attach 事务、回放 credit 与资源回收。 */
import { describe, expect, it, vi } from 'vitest'
import type { WebSocketLike } from '../transport/socket'
import type { SocketData } from '../shared/types'
import { createSharedWebSocketRuntime, type MessagePortLike } from './runtime'
import { SharedWorkerTransport } from '../transport/shared-worker'
import { normalizeWebSocketOptions } from '../config/normalize'
import { CONTROL_PROTOCOL_MAJOR } from '../shared/constants'
import { PageWebSocketClient } from '../page/client'
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

  /** 模拟当前端口收到无法反序列化的 Worker 消息。 */
  messageError(): void {
    this.emit('messageerror', undefined)
  }

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

  it('reopens a logically closed client and accepts a new creator URL after entry release', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const firstConfig = normalizeWebSocketOptions('wss://example.test/first', { id: 'released-endpoint', idleGraceMs: 0 })
      const createFirstTransport = (): SharedWorkerTransport<SocketData, SocketData> => {
        const pair = createPortPair()
        runtime.connect(pair[1])
        return new SharedWorkerTransport({ clientId: 'first', config: firstConfig, mode: 'inline', worker: { port: pair[0] } })
      }
      const first = new PageWebSocketClient(firstConfig, createFirstTransport(), { id: 'released-endpoint', idleGraceMs: 0 }, 'first', createFirstTransport)
      const firstOpen = first.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await firstOpen
      await first.close()
      await waitFor(() => sockets[0]?.readyState === 3)

      const reopened = first.open()
      await waitFor(() => sockets.length === 2)
      sockets[1]?.open()
      await reopened
      expect(urls).toEqual(['wss://example.test/first', 'wss://example.test/first'])
      await first.close()
      await waitFor(() => sockets[1]?.readyState === 3)
      await first.dispose()

      const secondPair = createPortPair()
      runtime.connect(secondPair[1])
      const secondConfig = normalizeWebSocketOptions('wss://example.test/second', { id: 'released-endpoint', idleGraceMs: 0 })
      const second = new SharedWorkerTransport({ clientId: 'second', config: secondConfig, mode: 'inline', worker: { port: secondPair[0] } })
      second.attach({ id: 'second' })
      const secondOpen = second.open()
      await waitFor(() => sockets.length === 3)
      sockets[2]?.open()
      await secondOpen
      expect(urls.at(-1)).toBe('wss://example.test/second')
    }
    finally {
      runtime.dispose()
    }
  })

  it('broadcasts every frame while transferring one execution key after freeze', async () => {
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
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'exclusive-shared' })
      const firstMessages: unknown[] = []
      const secondMessages: unknown[] = []
      const firstKeys: boolean[] = []
      const secondKeys: boolean[] = []
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      first.attach({ id: 'first', onKeyChange: (_key, held) => firstKeys.push(held), onMessage: data => firstMessages.push(data) })
      second.attach({ id: 'second', onKeyChange: (_key, held) => secondKeys.push(held), onMessage: data => secondMessages.push(data) })
      await first.registerExclusiveKey('confirm')
      await second.registerExclusiveKey('confirm')
      await waitFor(() => firstKeys.length === 1)
      expect(firstKeys).toEqual([true])
      expect(secondKeys).toEqual([])

      const opening = Promise.all([first.open(), second.open()])
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.message('broadcast')
      await waitFor(() => firstMessages.length === 1 && secondMessages.length === 1)

      first.setVisibility('frozen')
      await waitFor(() => firstKeys.length === 2 && secondKeys.length === 1)
      expect(firstKeys).toEqual([true, false])
      expect(secondKeys).toEqual([true])
      expect(firstMessages).toEqual(['broadcast'])
      expect(secondMessages).toEqual(['broadcast'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('does not accept a stale grant queued before the page freeze barrier', async () => {
    const documentTarget = new EventTarget()
    Object.defineProperties(documentTarget, { hidden: { value: false }, visibilityState: { value: 'visible' } })
    vi.stubGlobal('document', documentTarget)
    vi.stubGlobal('window', new EventTarget())
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const holderPair = createPortPair()
      const candidatePair = createPortPair()
      runtime.connect(holderPair[1])
      runtime.connect(candidatePair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'freeze-grant-barrier' })
      const holder = new SharedWorkerTransport({ clientId: 'holder', config, mode: 'inline', worker: { port: holderPair[0] } })
      const candidateTransport = new SharedWorkerTransport({ clientId: 'candidate', config, mode: 'inline', worker: { port: candidatePair[0] } })
      const candidate = new PageWebSocketClient(config, candidateTransport, { id: 'freeze-grant-barrier' }, 'candidate')
      const keyed: string[] = []
      holder.attach({ id: 'holder' })
      await holder.registerExclusiveKey('write')
      candidate.onMessage(event => keyed.push(String(event.data)), { key: 'write' })
      const opening = Promise.all([holder.open(), candidate.open()])
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      const transfer = holder.unregisterExclusiveKey('write')
      documentTarget.dispatchEvent(new Event('freeze'))
      await transfer
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(candidate.holdsKey('write')).toBe(false)
      sockets[0]?.message('while-frozen')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(keyed).toEqual([])

      documentTarget.dispatchEvent(new Event('resume'))
      await waitFor(() => candidate.holdsKey('write'))
      sockets[0]?.message('after-resume')
      await waitFor(() => keyed.length === 1)
      expect(keyed).toEqual(['after-resume'])
      await candidate.dispose()
      holder.dispose()
    }
    finally {
      runtime.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('gates keyed handlers while a returning hidden page validates its Worker authority', async () => {
    let hidden = false
    const documentTarget = new EventTarget()
    Object.defineProperties(documentTarget, {
      hidden: { get: () => hidden },
      visibilityState: { get: () => hidden ? 'hidden' : 'visible' },
    })
    vi.stubGlobal('document', documentTarget)
    vi.stubGlobal('window', new EventTarget())
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'hidden-authority-validation' })
      const transport = new SharedWorkerTransport({ clientId: 'client', config, mode: 'inline', worker: { port: pair[0] } })
      const client = new PageWebSocketClient(config, transport, { id: 'hidden-authority-validation' }, 'client')
      const keyed: string[] = []
      const views: string[] = []
      client.onMessage(event => keyed.push(String(event.data)), { key: 'write' })
      client.onMessage(event => views.push(String(event.data)))
      const opening = client.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      await waitFor(() => client.holdsKey('write'))
      sockets[0]?.message('before')
      await waitFor(() => keyed.length === 1)

      hidden = true
      documentTarget.dispatchEvent(new Event('visibilitychange'))
      await new Promise(resolve => setTimeout(resolve, 0))
      let heldResponse: unknown
      const postToPage = pair[1].postMessage.bind(pair[1])
      pair[1].postMessage = (message): void => {
        const record = message as { readonly ok?: unknown, readonly type?: unknown, readonly value?: unknown }
        if (heldResponse === undefined
          && record.type === 'response'
          && record.ok === true
          && typeof record.value === 'object'
          && record.value !== null
          && 'attached' in record.value) {
          heldResponse = message
          return
        }
        postToPage(message)
      }
      hidden = false
      documentTarget.dispatchEvent(new Event('visibilitychange'))
      await waitFor(() => heldResponse !== undefined)

      sockets[0]?.message('during-validation')
      await waitFor(() => views.length === 2)
      expect(client.holdsKey('write')).toBe(true)
      expect(keyed).toEqual(['before'])
      postToPage(heldResponse)
      await new Promise(resolve => setTimeout(resolve, 0))

      sockets[0]?.message('after-validation')
      await waitFor(() => keyed.length === 2)
      expect(keyed).toEqual(['before', 'after-validation'])
      await client.dispose()
    }
    finally {
      runtime.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('does not let an unattached page reserve a key before it opens', async () => {
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
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'unattached-key' })
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      const firstKeys: boolean[] = []
      const secondKeys: boolean[] = []

      await first.registerExclusiveKey('single')
      second.attach({ id: 'second', onKeyChange: (_key, held) => secondKeys.push(held) })
      await second.registerExclusiveKey('single')
      const secondOpen = second.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await secondOpen
      await waitFor(() => secondKeys.length === 1)
      expect(secondKeys).toEqual([true])

      first.attach({ id: 'first', onKeyChange: (_key, held) => firstKeys.push(held) })
      await first.open()
      expect(firstKeys).toEqual([])
      expect(secondKeys).toEqual([true])
    }
    finally {
      runtime.dispose()
    }
  })

  it('does not let a hidden holder lose its key until an explicit transfer event', async () => {
    const runtime = createSharedWebSocketRuntime()
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'hidden-holder' })
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      const firstKeys: boolean[] = []
      const secondKeys: boolean[] = []
      first.attach({ id: 'first', onKeyChange: (_key, held) => firstKeys.push(held) })
      second.attach({ id: 'second', onKeyChange: (_key, held) => secondKeys.push(held) })
      await first.registerExclusiveKey('single')
      await second.registerExclusiveKey('single')
      await waitFor(() => firstKeys.length === 1)

      first.setVisibility('hidden')
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(firstKeys).toEqual([true])
      expect(secondKeys).toEqual([])
    }
    finally {
      runtime.dispose()
    }
  })

  it('transfers an execution key when the current holder closes', async () => {
    const runtime = createSharedWebSocketRuntime()
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'close-holder' })
      const firstKeys: boolean[] = []
      const secondKeys: boolean[] = []
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      first.attach({ id: 'first', onKeyChange: (_key, held) => firstKeys.push(held) })
      second.attach({ id: 'second', onKeyChange: (_key, held) => secondKeys.push(held) })
      await first.registerExclusiveKey('single')
      await second.registerExclusiveKey('single')
      await waitFor(() => firstKeys.length === 1)

      await first.close()
      await waitFor(() => secondKeys.length === 1)
      expect(firstKeys).toEqual([true, false])
      expect(secondKeys).toEqual([true])
    }
    finally {
      runtime.dispose()
    }
  })

  it('transfers an execution key after the holder lease expires', async () => {
    vi.useFakeTimers()
    let currentTime = 0
    const runtime = createSharedWebSocketRuntime({ now: () => currentTime })
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'lease-holder',
        lease: { interval: 10, timeout: 20 },
      })
      const firstMessages: unknown[] = []
      const secondMessages: unknown[] = []
      firstPair[0].addEventListener('message', event => firstMessages.push(event.data))
      secondPair[0].addEventListener('message', event => secondMessages.push(event.data))
      const hello = (port: LinkedPort, clientId: string, requestId: string): void => {
        port.postMessage({
          clientId,
          configCanonical: config.configCanonical,
          configFingerprint: config.configFingerprint,
          id: config.id,
          protocolMajor: CONTROL_PROTOCOL_MAJOR,
          requestId,
          restore: config.local.lifecycle,
          shared: config.shared,
          type: 'hello',
          url: config.url,
          visibility: 'visible',
        })
      }
      hello(firstPair[0], 'first', 'hello-first')
      hello(secondPair[0], 'second', 'hello-second')
      await Promise.resolve()
      await Promise.resolve()
      firstPair[0].postMessage({ key: 'single', requestId: 'key-first', type: 'register-key' })
      secondPair[0].postMessage({ key: 'single', requestId: 'key-second', type: 'register-key' })
      await Promise.resolve()
      await Promise.resolve()
      expect(firstMessages).toContainEqual({ key: 'single', type: 'key-granted' })

      currentTime = 10
      secondPair[0].postMessage({ type: 'lease' })
      await Promise.resolve()
      currentTime = 25
      await vi.advanceTimersByTimeAsync(1_000)
      await Promise.resolve()
      await Promise.resolve()
      expect(secondMessages).toContainEqual({ key: 'single', type: 'key-granted' })
    }
    finally {
      runtime.dispose()
      vi.useRealTimers()
    }
  })

  it('rejects new distinct keys at the Worker limit without revoking existing holders', async () => {
    const pair = createPortPair()
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxExclusiveKeys: 1 } })
    try {
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'exclusive-limit' })
      const held: string[] = []
      const transport = new SharedWorkerTransport({ clientId: 'client', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'client', onKeyChange: (key, value) => value && held.push(key) })
      await transport.registerExclusiveKey('first')
      await waitFor(() => held.length === 1)
      await expect(transport.registerExclusiveKey('second')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' })
      expect(held).toEqual(['first'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps the global key limit exact when a transferred grant closes its target port', async () => {
    const firstPair = createPortPair()
    const secondPair = createPortPair()
    const thirdPair = createPortPair()
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxExclusiveKeys: 1 } })
    try {
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      runtime.connect(thirdPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'exclusive-limit-reentrant-release' })
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      const third = new SharedWorkerTransport({ clientId: 'third', config, mode: 'inline', worker: { port: thirdPair[0] } })
      const firstHeld: boolean[] = []
      const thirdHeld: boolean[] = []
      first.attach({ id: 'first', onKeyChange: (_key, held) => firstHeld.push(held) })
      second.attach({ id: 'second' })
      third.attach({ id: 'third', onKeyChange: (_key, held) => thirdHeld.push(held) })
      await first.registerExclusiveKey('transferred')
      await second.registerExclusiveKey('transferred')
      await waitFor(() => firstHeld.length === 1)

      const postToSecondPage = secondPair[1].postMessage.bind(secondPair[1])
      secondPair[1].postMessage = (message): void => {
        if ((message as { readonly type?: unknown }).type === 'key-granted')
          throw new Error('target port failed')
        postToSecondPage(message)
      }
      await first.unregisterExclusiveKey('transferred')

      await third.registerExclusiveKey('replacement')
      await waitFor(() => thirdHeld.length === 1)
      await expect(first.registerExclusiveKey('must-overflow')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' })
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps open usable when a pre-open key is rejected by the Worker limit', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
      workerLimits: { maxExclusiveKeys: 1 },
    })
    try {
      const firstPair = createPortPair()
      const secondPair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(secondPair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'pre-open-key-limit' })
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      const errors: unknown[] = []
      first.attach({ id: 'first' })
      await first.registerExclusiveKey('existing')
      const firstOpen = first.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await firstOpen

      await second.registerExclusiveKey('rejected-before-open')
      second.attach({ id: 'second', onError: error => errors.push(error) })
      await expect(second.open()).resolves.toMatchObject({ state: 'open' })
      expect(errors).toEqual([expect.objectContaining({ code: 'RESOURCE_LIMIT_EXCEEDED' })])
    }
    finally {
      runtime.dispose()
    }
  })

  it('revokes cached key authority when the SharedWorker control channel fails', async () => {
    const pair = createPortPair()
    const runtime = createSharedWebSocketRuntime()
    try {
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'exclusive-disconnect' })
      const held: boolean[] = []
      const transport = new SharedWorkerTransport({ clientId: 'client', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'client', onKeyChange: (_key, value) => held.push(value) })
      await transport.registerExclusiveKey('write')
      await waitFor(() => held.length === 1)

      pair[0].messageError()

      expect(held).toEqual([true, false])
    }
    finally {
      runtime.dispose()
    }
  })

  it('lets one Worker-selected page atomically replace the next reconnect URL and delay', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/old', {
        autoReconnect: { initialDelay: 1_000, jitter: 0 },
        id: 'worker-reconnect-plan',
      })
      const transport = new SharedWorkerTransport({ clientId: 'client', config, mode: 'inline', worker: { port: pair[0] } })
      const plans: string[] = []
      transport.attach({
        id: 'client',
        onBeforeReconnect: (plan) => {
          plans.push(plan.id)
          void transport.completeReconnectPlan(plan.id, { delay: 0, url: 'wss://example.test/new?token=secret' })
        },
      })
      await transport.setReconnectHook(true)
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.close(1006)

      await waitFor(() => sockets.length === 2)
      expect(plans).toHaveLength(1)
      expect(urls).toEqual(['wss://example.test/old', 'wss://example.test/new?token=secret'])

      const laterPair = createPortPair()
      runtime.connect(laterPair[1])
      const laterConfig = normalizeWebSocketOptions('wss://example.test/other', {
        autoReconnect: { initialDelay: 1_000, jitter: 0 },
        id: 'worker-reconnect-plan',
      })
      const later = new SharedWorkerTransport({ clientId: 'later', config: laterConfig, mode: 'inline', worker: { port: laterPair[0] } })
      later.attach({ id: 'later' })
      const laterOpen = later.open()
      sockets[1]?.open()
      await laterOpen
      expect(urls).toHaveLength(2)
    }
    finally {
      runtime.dispose()
    }
  })

  it('aborts a frozen reconnect owner and rejects its stale submission after transfer', async () => {
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
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'worker-reconnect-transfer' })
      const first = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: firstPair[0] } })
      const second = new SharedWorkerTransport({ clientId: 'second', config, mode: 'inline', worker: { port: secondPair[0] } })
      let firstPlan = ''
      let firstAborted = ''
      first.attach({
        id: 'first',
        onBeforeReconnect: (plan) => { firstPlan = plan.id },
        onReconnectAbort: (planId) => { firstAborted = planId },
      })
      second.attach({
        id: 'second',
        onBeforeReconnect: (plan) => { void second.completeReconnectPlan(plan.id, { delay: 0 }) },
      })
      await first.setReconnectHook(true)
      await second.setReconnectHook(true)
      const opening = Promise.all([first.open(), second.open()])
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.close(1006)
      await waitFor(() => firstPlan.length > 0)
      first.setVisibility('frozen')
      await waitFor(() => sockets.length === 2)

      expect(firstAborted).toBe(firstPlan)
      await expect(first.completeReconnectPlan(firstPlan, { delay: 0 })).rejects.toMatchObject({ code: 'STALE_RECONNECT_PLAN' })
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

  it('rejects duplicate logical client ids without replacing the existing control route', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const firstPair = createPortPair()
      const duplicatePair = createPortPair()
      runtime.connect(firstPair[1])
      runtime.connect(duplicatePair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'duplicate-client-id' })
      const first = new SharedWorkerTransport({ clientId: 'same-client', config, mode: 'inline', worker: { port: firstPair[0] } })
      const duplicate = new SharedWorkerTransport({ clientId: 'same-client', config, mode: 'inline', worker: { port: duplicatePair[0] } })
      first.attach({ id: 'same-client' })
      const opening = first.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      duplicate.attach({ id: 'same-client' })
      await expect(duplicate.open()).rejects.toMatchObject({ code: 'INVALID_CONTROL_MESSAGE' })
      await expect(first.send('still-routed')).resolves.toMatchObject({ status: 'accepted' })
      expect(sockets[0]?.sent).toEqual(['still-routed'])
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

  it('keeps a reusable closed port within maxPorts until it is disposed or its lease expires', async () => {
    const runtime = createSharedWebSocketRuntime({ workerLimits: { maxPorts: 1 } })
    try {
      const first = createPortPair()
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'port-reclaim' })
      runtime.connect(first[1])
      const firstTransport = new SharedWorkerTransport({ clientId: 'first', config, mode: 'inline', worker: { port: first[0] } })
      firstTransport.attach({ id: 'first' })
      await waitFor(() => !first[1].closed)
      await firstTransport.close()

      // 立即重新 open 的端口必须仍然可用，因此 close 不能马上归还额度。
      const second = createPortPair()
      runtime.connect(second[1])
      expect(second[1].closed).toBe(true)

      firstTransport.dispose()
      await Promise.resolve()
      const third = createPortPair()
      runtime.connect(third[1])
      expect(third[1].closed).toBe(false)
    }
    finally {
      runtime.dispose()
    }
  })

  it('reclaims a closed port quota once its lease grace elapses without a reopen', async () => {
    let currentTime = 0
    /** 手动驱动 lease sweep，避免占用真实时钟等待一整个扫描周期。 */
    const sweeps: (() => void)[] = []
    const runtime = createSharedWebSocketRuntime({
      clearTimeout: () => undefined,
      now: () => currentTime,
      setTimeout: (callback, delay) => {
        if (delay === 1_000)
          sweeps.push(callback)
        return 0
      },
      workerLimits: { maxPorts: 1 },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'closed-port-quota',
        lease: { interval: 10, timeout: 20 },
      })
      // 页面卸载的默认路径只调用 close()，不调用 dispose()；额度必须最终回收，
      // 否则新标签页会在 maxPorts 耗尽后静默降级为 direct。
      for (let index = 0; index < 3; index++) {
        const pair = createPortPair()
        runtime.connect(pair[1])
        const transport = new SharedWorkerTransport({ clientId: `tab-${index}`, config, mode: 'inline', worker: { port: pair[0] } })
        transport.attach({ id: `tab-${index}` })
        await waitFor(() => !pair[1].closed)
        await transport.close()
        currentTime += 50
        sweeps.splice(0).forEach(sweep => sweep())
        await Promise.resolve()
      }

      const replacement = createPortPair()
      runtime.connect(replacement[1])
      expect(replacement[1].closed).toBe(false)
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps an attached client alive while its page lease timer keeps reporting', async () => {
    let currentTime = 0
    const sockets: FakeSocket[] = []
    const sweeps: (() => void)[] = []
    /** 页面 lease 周期回调；由测试驱动，代替真实 setInterval。 */
    const leaseTicks: (() => void)[] = []
    const runtime = createSharedWebSocketRuntime({
      clearTimeout: () => undefined,
      now: () => currentTime,
      setTimeout: (callback, delay) => {
        if (delay === 1_000)
          sweeps.push(callback)
        return 0
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'lease-liveness',
        lease: { interval: 10, timeout: 20 },
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({
        clientId: 'tab',
        config,
        mode: 'inline',
        setInterval: (callback) => {
          leaseTicks.push(callback)
          return 0
        },
        worker: { port: pair[0] },
      })
      transport.attach({ id: 'tab' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      await waitFor(() => leaseTicks.length === 1)

      // 越过 lease timeout 但持续报活：sweep 不能回收这个 client。
      for (let round = 0; round < 3; round++) {
        currentTime += 15
        leaseTicks.forEach(tick => tick())
        await Promise.resolve()
        await Promise.resolve()
        sweeps.splice(0).forEach(sweep => sweep())
        await Promise.resolve()
      }
      expect(pair[1].closed).toBe(false)

      // 停止报活并越过 timeout 后才允许回收。
      currentTime += 50
      sweeps.splice(0).forEach(sweep => sweep())
      await waitFor(() => pair[1].closed)
      expect(pair[1].closed).toBe(true)
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
        protocolMajor: CONTROL_PROTOCOL_MAJOR,
        requestId: 'forged',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
        visibility: 'visible',
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
        protocolMajor: CONTROL_PROTOCOL_MAJOR,
        requestId: 'slow-hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
        visibility: 'visible',
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
        protocolMajor: CONTROL_PROTOCOL_MAJOR,
        requestId: 'slow-hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
        visibility: 'visible',
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

  it('drops a single frame above the delivery ceiling without redelivering it later', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({ socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ceiling-room' })
      const messages: unknown[] = []
      pair[0].addEventListener('message', event => messages.push(event.data))
      pair[0].postMessage({
        clientId: 'a',
        configCanonical: config.configCanonical,
        configFingerprint: config.configFingerprint,
        id: config.id,
        protocolMajor: CONTROL_PROTOCOL_MAJOR,
        requestId: 'hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
        visibility: 'visible',
      })
      pair[0].postMessage({ requestId: 'open', type: 'open' })
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'open'))

      // 额度全空时投递单条超限消息；它不能被排队等待额度恢复。
      sockets[0]?.message('x'.repeat(5 * 1024 * 1024))
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow'))
      expect(messages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message')).toEqual([])

      // 后续正常消息仍能投递，证明超限帧没有占用额度。
      sockets[0]?.message('small')
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message'))
      expect(messages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message')).toMatchObject([{ data: 'small' }])
    }
    finally {
      runtime.dispose()
    }
  })

  it('delivers decoded payloads whose prototype is not Object.prototype', async () => {
    const sockets: FakeSocket[] = []
    /** 业务 adapter 常见的解码产物：可结构化克隆但原型不是 Object.prototype。 */
    class Order {
      constructor(readonly orderId: string) {}
    }
    const adapter = {
      classify: (data: unknown) => ({ data, type: 'data' as const }),
      decode: (data: SocketData) => new Order(String(data)),
      encode: (value: unknown) => String(value),
      id: 'order.stream',
      version: 1,
    }
    const runtime = createSharedWebSocketRuntime({
      protocols: [adapter as never],
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const pair = createPortPair()
      runtime.connect(pair[1])
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'prototype-room',
        protocol: adapter as never,
        worker: () => ({ port: pair[0] }) as never,
      })
      const messages: unknown[] = []
      pair[0].addEventListener('message', event => messages.push(event.data))
      pair[0].postMessage({
        clientId: 'a',
        configCanonical: config.configCanonical,
        configFingerprint: config.configFingerprint,
        id: config.id,
        protocolMajor: CONTROL_PROTOCOL_MAJOR,
        requestId: 'hello',
        restore: config.local.lifecycle,
        shared: config.shared,
        type: 'hello',
        url: config.url,
        visibility: 'visible',
      })
      pair[0].postMessage({ requestId: 'open', type: 'open' })
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'open'))
      sockets[0]?.message('order-1')
      await waitFor(() => messages.some(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message'))
      expect(messages.find(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'message')).toMatchObject({
        data: { orderId: 'order-1' },
      })
      expect(messages.filter(message => typeof message === 'object' && message !== null && 'type' in message && message.type === 'overflow')).toEqual([])
    }
    finally {
      runtime.dispose()
    }
  })
})
