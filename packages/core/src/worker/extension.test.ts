/** 验证连接作用域扩展的工厂调用、生命周期时机与故障隔离。 */
import { describe, expect, it } from 'vitest'
import type { WebSocketLike } from '../transport/socket'
import type { SocketData } from '../shared/types'
import { type ConnectionExtension, type ConnectionExtensionContext, createSharedWebSocketRuntime, type MessagePortLike } from './runtime'
import { SharedWorkerTransport } from '../transport/shared-worker'
import { normalizeWebSocketOptions } from '../config/normalize'

/** 双向连接的测试 MessagePort。 */
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

/** 可手动推进的测试 WebSocket。 */
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

/** 创建一对互相连接的测试端口。 */
function createPortPair(): readonly [LinkedPort, LinkedPort] {
  const page = new LinkedPort()
  const worker = new LinkedPort()
  page.peer = worker
  worker.peer = page
  return [page, worker]
}

/** 等待异步投递满足条件。 */
async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (check())
      return
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  throw new Error('condition not reached')
}

describe('connection-scoped extension lifecycle', () => {
  it('creates one extension per shared connection and reports a safe context', async () => {
    const sockets: FakeSocket[] = []
    const contexts: ConnectionExtensionContext[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (context) => {
        contexts.push(context)
        return {}
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const first = normalizeWebSocketOptions('wss://example.test/one?token=secret', { id: 'ext-one' })
      const second = normalizeWebSocketOptions('wss://example.test/two', { id: 'ext-two' })
      for (const [index, config] of [first, second].entries()) {
        const pair = createPortPair()
        runtime.connect(pair[1])
        const transport = new SharedWorkerTransport({ clientId: `c${index}`, config, mode: 'inline', worker: { port: pair[0] } })
        transport.attach({ id: `c${index}` })
        const opening = transport.open()
        await waitFor(() => sockets.length === index + 1)
        sockets[index]?.open()
        await opening
      }
      expect(contexts).toHaveLength(2)
      expect(contexts.map(context => context.connectionId)).toEqual(['ext-one', 'ext-two'])
      // 上下文只暴露 origin，不含 path、query 或凭据。
      expect(contexts[0]?.endpointOrigin).toBe('wss://example.test')
      expect(JSON.stringify(contexts)).not.toContain('secret')
    }
    finally {
      runtime.dispose()
    }
  })

  it('does not create a second extension when another tab joins the same connection', async () => {
    const sockets: FakeSocket[] = []
    let created = 0
    const runtime = createSharedWebSocketRuntime({
      createExtension: () => {
        created++
        return {}
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-shared' })
      const transports = [0, 1].map((index) => {
        const pair = createPortPair()
        runtime.connect(pair[1])
        const transport = new SharedWorkerTransport({ clientId: `c${index}`, config, mode: 'inline', worker: { port: pair[0] } })
        transport.attach({ id: `c${index}` })
        return transport
      })
      const opening = Promise.all(transports.map(transport => transport.open()))
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      expect(created).toBe(1)
    }
    finally {
      runtime.dispose()
    }
  })

  it('notifies socket open before fan-out and again after a reconnect', async () => {
    const sockets: FakeSocket[] = []
    const events: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        onSocketOpen: context => events.push(`open:${context.attempt}`),
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        id: 'ext-open',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c', onMessage: () => events.push('message') })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.message('frame')
      await waitFor(() => events.includes('message'))
      // 扩展必须先于业务帧派发观察到 open。
      expect(events).toEqual(['open:1', 'message'])

      sockets[0]?.close(1006)
      await waitFor(() => sockets.length === 2)
      sockets[1]?.open()
      await waitFor(() => events.filter(event => event.startsWith('open:')).length === 2)
      expect(events.filter(event => event.startsWith('open:'))).toEqual(['open:1', 'open:2'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('disposes the extension when the connection entry is released and rebuilds it afterwards', async () => {
    const sockets: FakeSocket[] = []
    const events: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => {
        events.push('create')
        return { dispose: () => events.push('dispose') }
      },
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-dispose', idleGraceMs: 0 })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      transport.dispose()
      await waitFor(() => events.includes('dispose'))
      expect(events).toEqual(['create', 'dispose'])

      const rebuilt = createPortPair()
      runtime.connect(rebuilt[1])
      const second = new SharedWorkerTransport({ clientId: 'c2', config, mode: 'inline', worker: { port: rebuilt[0] } })
      second.attach({ id: 'c2' })
      const reopening = second.open()
      await waitFor(() => sockets.length === 2)
      sockets[1]?.open()
      await reopening
      expect(events).toEqual(['create', 'dispose', 'create'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('drops filtered frames for every tab without consuming delivery credit', async () => {
    const sockets: FakeSocket[] = []
    let calls = 0
    const seen = new Set<string>()
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        filterInbound: (data) => {
          calls++
          const id = String(data)
          if (seen.has(id))
            return 'drop'
          seen.add(id)
          return 'deliver'
        },
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-filter' })
      const first = createPortPair()
      const second = createPortPair()
      runtime.connect(first[1])
      runtime.connect(second[1])
      const firstMessages: unknown[] = []
      const secondMessages: unknown[] = []
      const a = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: first[0] } })
      const b = new SharedWorkerTransport({ clientId: 'b', config, mode: 'inline', worker: { port: second[0] } })
      a.attach({ id: 'a', onMessage: data => firstMessages.push(data) })
      b.attach({ id: 'b', onMessage: data => secondMessages.push(data) })
      const opening = Promise.all([a.open(), b.open()])
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      for (const id of ['1', '2', '2', '3', '1'])
        sockets[0]?.message(id)
      await waitFor(() => firstMessages.length === 3 && secondMessages.length === 3)
      // 去重对两个标签页同时生效，且过滤每帧每连接只调用一次。
      expect(firstMessages).toEqual(['1', '2', '3'])
      expect(secondMessages).toEqual(['1', '2', '3'])
      expect(calls).toBe(5)
    }
    finally {
      runtime.dispose()
    }
  })

  it('does not spend delivery credit on dropped frames', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        filterInbound: data => String(data).startsWith('noise') ? 'drop' : 'deliver',
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-credit' })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const overflows: unknown[] = []
      const wanted: unknown[] = []
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'a', onMessage: data => wanted.push(data), onOverflow: event => overflows.push(event) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      // 远超单页 256 条投递额度的噪音帧全部被丢弃；额度未被占用，
      // 因此其后的业务帧仍然完整送达且不产生 inbound overflow。
      for (let index = 0; index < 600; index++)
        sockets[0]?.message(`noise-${index}`)
      for (let index = 0; index < 10; index++)
        sockets[0]?.message(`wanted-${index}`)
      await waitFor(() => wanted.length === 10)
      expect(overflows).toEqual([])
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps filtered frames out of a suspended tab replay buffer', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        filterInbound: data => String(data).startsWith('noise') ? 'drop' : 'deliver',
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        id: 'ext-filter-replay',
        lifecycle: { restore: { replay: true } },
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const received: { data: unknown, replayed: boolean }[] = []
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'a', onMessage: (data, _receivedAt, replayed) => received.push({ data, replayed: replayed ?? false }) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      transport.suspend()
      sockets[0]?.message('noise-a')
      sockets[0]?.message('wanted-a')
      await new Promise(resolve => setTimeout(resolve, 0))
      transport.restore()
      await waitFor(() => received.length === 1)
      // 过滤发生在 sink 之前，因此被丢弃的帧根本不会进入回放缓冲。
      expect(received).toEqual([{ data: 'wanted-a', replayed: true }])
    }
    finally {
      runtime.dispose()
    }
  })

  it('delivers the frame when the filter throws', async () => {
    const sockets: FakeSocket[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        filterInbound: () => {
          throw new Error('filter boom')
        },
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-filter-throw' })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const received: unknown[] = []
      const transport = new SharedWorkerTransport({ clientId: 'a', config, mode: 'inline', worker: { port: pair[0] } })
      const errors: { readonly code: string }[] = []
      transport.attach({ id: 'a', onError: error => errors.push(error), onMessage: data => received.push(data) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.message('must-not-vanish')
      await waitFor(() => received.length === 1)
      // 静默丢弃全局消息比重复投递严重得多，因此过滤异常必须按放行降级。
      expect(received).toEqual(['must-not-vanish'])
      // 但失败必须可观测：扩展 bug 不能静默，否则业务无法发现自己的过滤器坏了。
      await waitFor(() => errors.length > 0)
      expect(errors[0]?.code).toBe('INTERNAL_STATE_ERROR')
      // 异常文本绝不跨端口传播。
      expect(JSON.stringify(errors)).not.toContain('filter boom')
    }
    finally {
      runtime.dispose()
    }
  })

  it('lets the extension atomically replace the next endpoint and delay without any page', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const reasons: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: async (context) => {
          reasons.push(context.reason)
          await Promise.resolve()
          context.setOptions({ url: 'wss://example.test/refreshed?token=fresh' })
          context.setDelay(0)
        },
      }),
      socketFactory: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      // 扩展会把 delay 覆盖为 0，因此不必等待默认退避即可观察下一次尝试。
      const config = normalizeWebSocketOptions('wss://example.test/original', {
        autoReconnect: { initialDelay: 50, jitter: 0 },
        id: 'ext-prepare',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      // 页面没有注册 onBeforeReconnect，也没有任何活跃候选页面。
      const plans: string[] = []
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c', onBeforeReconnect: plan => plans.push(plan.id) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      sockets[0]?.close(1006)
      await waitFor(() => sockets.length === 2)
      expect(urls).toEqual(['wss://example.test/original', 'wss://example.test/refreshed?token=fresh'])
      expect(reasons).toEqual(['socket-close'])
      // 扩展接管后页面不再被选为候选。
      expect(plans).toEqual([])
    }
    finally {
      runtime.dispose()
    }
  })

  it('does not prepare an attempt for the very first open', async () => {
    const sockets: FakeSocket[] = []
    let prepared = 0
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: () => {
          prepared++
        },
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-first-open' })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      expect(prepared).toBe(0)
    }
    finally {
      runtime.dispose()
    }
  })

  it('applies a url-only or delay-only draft and falls back for the field left untouched', async () => {
    for (const mode of ['url-only', 'delay-only', 'neither'] as const) {
      const sockets: FakeSocket[] = []
      const urls: string[] = []
      const runtime = createSharedWebSocketRuntime({
        createExtension: (): ConnectionExtension => ({
          prepareAttempt: (context) => {
            if (mode === 'url-only')
              context.setOptions({ url: 'wss://example.test/only-url' })
            if (mode === 'delay-only')
              context.setDelay(0)
          },
        }),
        socketFactory: (url) => {
          urls.push(url)
          const socket = new FakeSocket()
          sockets.push(socket)
          return socket
        },
      })
      try {
        const config = normalizeWebSocketOptions('wss://example.test/original', {
          autoReconnect: { initialDelay: 0, jitter: 0 },
          id: `ext-partial-${mode}`,
        })
        const pair = createPortPair()
        runtime.connect(pair[1])
        const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
        transport.attach({ id: 'c' })
        const opening = transport.open()
        await waitFor(() => sockets.length === 1)
        sockets[0]?.open()
        await opening
        sockets[0]?.close(1006)
        await waitFor(() => sockets.length === 2)
        // 未覆盖的字段必须回退到计划默认值，而不是被部分应用。
        expect(urls[1]).toBe(mode === 'url-only' ? 'wss://example.test/only-url' : 'wss://example.test/original')
      }
      finally {
        runtime.dispose()
      }
    }
  })

  it('rejects an invalid url without changing the endpoint', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const codes: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: (context) => {
          for (const invalid of ['/relative', 'https://example.test/x']) {
            try {
              context.setOptions({ url: invalid })
            }
            catch (error) {
              codes.push((error as { code?: string }).code ?? 'unknown')
            }
          }
        },
      }),
      socketFactory: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/original', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        id: 'ext-invalid-url',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      sockets[0]?.close(1006)
      await waitFor(() => sockets.length === 2)
      expect(codes).toEqual(['INVALID_OPTIONS', 'INVALID_OPTIONS'])
      expect(urls).toEqual(['wss://example.test/original', 'wss://example.test/original'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('prepares an attempt for a heartbeat timeout as well as a socket close', async () => {
    const sockets: FakeSocket[] = []
    const reasons: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: (context) => {
          reasons.push(context.reason)
          context.setDelay(0)
        },
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        heartbeat: { interval: 10, pongTimeout: 15 },
        id: 'ext-heartbeat-reason',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening
      // 服务端不回 pong，心跳超时必须进入同一条准备路径。
      await waitFor(() => reasons.includes('heartbeat-timeout'))
      expect(reasons[0]).toBe('heartbeat-timeout')
    }
    finally {
      runtime.dispose()
    }
  })

  it('falls back to the default plan when the extension preparation fails', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: () => {
          throw new Error('token refresh failed')
        },
      }),
      socketFactory: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/original', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        id: 'ext-prepare-throw',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      sockets[0]?.close(1006)
      await waitFor(() => sockets.length === 2)
      // 准备失败不得修改 endpoint，连接仍按默认计划继续。
      expect(urls).toEqual(['wss://example.test/original', 'wss://example.test/original'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('rejects a stale setter call after the preparation window closed', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const lateErrors: string[] = []
    let release: (() => void) | undefined
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        prepareAttempt: async (context) => {
          await new Promise<void>((resolve) => {
            release = resolve
          })
          // 期限过后调用 setter 必须被拒绝，且不改变已提交的计划。
          try {
            context.setOptions({ url: 'wss://example.test/too-late' })
          }
          catch (error) {
            lateErrors.push((error as { code?: string }).code ?? 'unknown')
          }
        },
      }),
      socketFactory: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/original', {
        autoReconnect: { hookTimeout: 10, initialDelay: 0, jitter: 0 },
        id: 'ext-prepare-stale',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c' })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      sockets[0]?.close(1006)
      // 等待总期限到达并采用默认计划，然后才放行迟到的 setter。
      await waitFor(() => sockets.length === 2)
      release?.()
      await waitFor(() => lateErrors.length === 1)
      expect(lateErrors).toEqual(['STALE_RECONNECT_PLAN'])
      expect(urls).toEqual(['wss://example.test/original', 'wss://example.test/original'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps using page candidates when the extension does not prepare attempts', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({}),
      socketFactory: (url) => {
        urls.push(url)
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/original', {
        autoReconnect: { initialDelay: 0, jitter: 0 },
        id: 'ext-page-fallback',
      })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({
        id: 'c',
        onBeforeReconnect: (plan) => {
          void transport.completeReconnectPlan(plan.id, { delay: 0, url: 'wss://example.test/from-page' })
        },
      })
      await transport.setReconnectHook(true)
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await opening

      sockets[0]?.close(1006)
      await waitFor(() => sockets.length === 2)
      // 扩展未提供 prepareAttempt 时，页面候选机制行为不变。
      expect(urls).toEqual(['wss://example.test/original', 'wss://example.test/from-page'])
    }
    finally {
      runtime.dispose()
    }
  })

  it('keeps the connection usable when extension callbacks throw', async () => {
    const sockets: FakeSocket[] = []
    const received: unknown[] = []
    const runtime = createSharedWebSocketRuntime({
      createExtension: (): ConnectionExtension => ({
        onSocketOpen: () => {
          throw new Error('extension boom')
        },
      }),
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    try {
      const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'ext-throw' })
      const pair = createPortPair()
      runtime.connect(pair[1])
      const transport = new SharedWorkerTransport({ clientId: 'c', config, mode: 'inline', worker: { port: pair[0] } })
      transport.attach({ id: 'c', onMessage: data => received.push(data) })
      const opening = transport.open()
      await waitFor(() => sockets.length === 1)
      sockets[0]?.open()
      await expect(opening).resolves.toMatchObject({ state: 'open' })
      sockets[0]?.message('still-delivered')
      await waitFor(() => received.length === 1)
      expect(received).toEqual(['still-delivered'])
    }
    finally {
      runtime.dispose()
    }
  })
})
