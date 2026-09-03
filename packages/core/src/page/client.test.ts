/** 验证稳定页面 client、动态 handler、脱敏和生命周期行为。 */
import { describe, expect, it } from 'vitest'
import type { BeforeReconnectContext, SocketData } from '../shared/types'
import type { WebSocketLike } from '../transport/socket'
import { normalizeWebSocketOptions } from '../config/normalize'
import { DirectTransport } from '../transport/direct'
import { PageWebSocketClient } from './client'

/** 页面 client 测试使用的可控 WebSocket。 */
class FakeSocket implements WebSocketLike {
  /** 测试 binaryType。 */
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  /** 测试 bufferedAmount。 */
  bufferedAmount = 0
  /** 可手动推进的 readyState。 */
  readyState = 0
  /** socket 事件监听器。 */
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>()

  /** 注册 socket 事件。 */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  /** 移除 socket 事件。 */
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(value => value !== listener))
  }

  /** 测试发送接口不执行网络操作。 */
  send(data: SocketData): void {
    void data
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

  it('runs every same-key handler in direct mode and aborts their grant on close', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-exclusive-handler' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-exclusive-handler' }, 'client')
    const calls: string[] = []
    let signal: AbortSignal | undefined
    client.onMessage((event, context) => {
      signal = context.signal
      calls.push(`first:${event.data}`)
    }, { key: 'confirm' })
    client.onMessage(event => calls.push(`second:${event.data}`), { key: 'confirm' })
    client.onMessage(event => calls.push(`view:${event.data}`))

    const opening = client.open()
    socket.open()
    await opening
    expect(client.holdsKey('confirm')).toBe(true)
    socket.message('one')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toEqual(['first:one', 'second:one', 'view:one'])

    await client.close()
    expect(client.holdsKey('confirm')).toBe(false)
    expect(signal?.aborted).toBe(true)
    await client.dispose()
  })

  it('requires a fresh grant and signal after an execution key is frozen', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-freeze-key' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-freeze-key' }, 'client')
    const keyed: string[] = []
    const views: string[] = []
    const signals: AbortSignal[] = []
    client.onMessage((event, context) => {
      keyed.push(String(event.data))
      signals.push(context.signal)
    }, { key: 'write' })
    client.onMessage(event => views.push(String(event.data)))
    const opening = client.open()
    socket.open()
    await opening

    socket.message('before')
    await new Promise(resolve => setTimeout(resolve, 0))
    transport.setVisibility('frozen')
    expect(client.holdsKey('write')).toBe(false)
    expect(signals[0]?.aborted).toBe(true)
    socket.message('queued-while-frozen')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(keyed).toEqual(['before'])
    expect(views).toEqual(['before', 'queued-while-frozen'])

    transport.setVisibility('visible')
    socket.message('after')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(keyed).toEqual(['before', 'after'])
    expect(signals[1]).not.toBe(signals[0])
    await client.dispose()
  })

  it('runs the page getter inside onBeforeReconnect and commits one direct plan', async () => {
    const sockets: FakeSocket[] = []
    const urls: string[] = []
    const config = normalizeWebSocketOptions('wss://example.test/old', { id: 'page-client-reconnect-hook' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: (url) => {
      urls.push(url)
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-reconnect-hook' }, 'client')
    const contexts: string[] = []
    let completedContext: BeforeReconnectContext | undefined
    client.onBeforeReconnect((context) => {
      completedContext = context
      contexts.push(`${context.reason}:${context.attempt}`)
      context.setOptions({ url: 'wss://example.test/new?cursor=fresh' })
      context.setDelay(0)
    })
    const opening = client.open()
    sockets[0]?.open()
    await opening
    sockets[0]?.close(1006)
    for (let index = 0; index < 20 && sockets.length < 2; index++)
      await new Promise(resolve => setTimeout(resolve, 0))

    expect(contexts).toEqual(['socket-close:1'])
    expect(urls).toEqual(['wss://example.test/old', 'wss://example.test/new?cursor=fresh'])
    expect(completedContext?.signal.aborted).toBe(true)
    expect(() => completedContext?.setDelay(1)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
    await client.dispose()
  })

  it('runs the same hook for explicit reconnect even when automatic retries are disabled', async () => {
    const sockets: FakeSocket[] = []
    const reasons: string[] = []
    const config = normalizeWebSocketOptions('wss://example.test/socket', { autoReconnect: false, id: 'page-client-explicit-hook' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    const client = new PageWebSocketClient(config, transport, { autoReconnect: false, id: 'page-client-explicit-hook' }, 'client')
    client.onBeforeReconnect((context) => {
      reasons.push(context.reason)
      context.setDelay(0)
    })
    const opening = client.open()
    sockets[0]?.open()
    await opening
    expect(reasons).toEqual([])

    await client.reconnect()
    for (let attempt = 0; attempt < 20 && sockets.length < 2; attempt++)
      await new Promise(resolve => setTimeout(resolve, 0))
    expect(reasons).toEqual(['explicit'])
    expect(sockets).toHaveLength(2)
    await client.dispose()
  })

  it('rejects reconnect before open and after logical close instead of creating an ownerless plan', async () => {
    const socket = new FakeSocket()
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-reconnect-stage' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => socket })
    const client = new PageWebSocketClient(config, transport, { id: 'page-client-reconnect-stage' }, 'client')

    await expect(client.reconnect()).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    const opening = client.open()
    socket.open()
    await opening
    await client.close()
    await expect(client.reconnect()).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    await client.dispose()
  })

  it('aborts a replaced reconnect hook without assigning the old plan to the replacement', async () => {
    const sockets: FakeSocket[] = []
    const diagnostics: unknown[] = []
    const errors: Error[] = []
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-reconnect-replace' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    const client = new PageWebSocketClient(config, transport, {
      id: 'page-client-reconnect-replace',
      logger: diagnostic => diagnostics.push(diagnostic),
      onError: (_client, error) => errors.push(error),
    }, 'client')
    let oldSignal: AbortSignal | undefined
    let releaseOld: (() => void) | undefined
    client.onBeforeReconnect(context => new Promise<void>((resolve) => {
      oldSignal = context.signal
      releaseOld = resolve
    }))
    const opening = client.open()
    sockets[0]?.open()
    await opening
    sockets[0]?.close(1006)
    for (let index = 0; index < 20 && oldSignal === undefined; index++)
      await new Promise(resolve => setTimeout(resolve, 0))

    client.onBeforeReconnect(() => {
      throw new Error('business-hook-secret')
    })
    expect(oldSignal?.aborted).toBe(true)
    releaseOld?.()

    // 新 handler 只服务后续 plan；替换不会让它接管旧 plan。
    expect(errors).toEqual([])
    expect(JSON.stringify(diagnostics)).not.toContain('business-hook-secret')
    await client.dispose()
  })

  it('reports hook failures with a stable safe error and continues the default plan', async () => {
    const sockets: FakeSocket[] = []
    const diagnostics: unknown[] = []
    const errors: Error[] = []
    const config = normalizeWebSocketOptions('wss://example.test/socket', { id: 'page-client-reconnect-error' })
    const transport = new DirectTransport({ clientId: 'client', config, socketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    } })
    const client = new PageWebSocketClient(config, transport, {
      id: 'page-client-reconnect-error',
      logger: diagnostic => diagnostics.push(diagnostic),
      onError: (_client, error) => errors.push(error),
    }, 'client')
    client.onBeforeReconnect(() => {
      throw new Error('business-hook-secret')
    })
    const opening = client.open()
    sockets[0]?.open()
    await opening
    sockets[0]?.close(1006)
    for (let index = 0; index < 20 && errors.length === 0; index++)
      await new Promise(resolve => setTimeout(resolve, 0))

    expect(errors).toEqual([expect.objectContaining({
      cause: undefined,
      code: 'INTERNAL_STATE_ERROR',
      message: 'Internal connection state error',
    })])
    expect(JSON.stringify(errors)).not.toContain('business-hook-secret')
    expect(JSON.stringify(diagnostics)).not.toContain('business-hook-secret')
    await client.dispose()
  })

  it('sanitizes rejected direct-path promises before they reach callers', async () => {
    const config = normalizeWebSocketOptions('wss://example.test/socket', {
      id: 'page-client-safe-promise',
      protocol: {
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
