/** 从真实端口的页面边界验证注册、观察者隔离、参与期取消和准备授权。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeforeReconnectContext } from '../shared/types'
import { harness, until } from '../../test/fixtures'
import { SocketFuseError } from '../shared/errors'

/** 当前测试资源集合。 */
const scopes: ReturnType<typeof harness>[] = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** 提供可控页面可见性，不用真实浏览器的调度替代恢复时序断言。 */
function lifecycle() {
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', new EventTarget())
  return (state: 'visible' | 'hidden'): void => {
    document.visibilityState = state
    document.dispatchEvent(new Event('visibilitychange'))
  }
}

/** 创建并打开一个直连接入的同构 client。 */
async function opened(restore = false) {
  const scope = harness('direct')
  scopes.push(scope)
  const client = scope.client({ lifecycle: { restore } })
  const opening = client.open()
  await until(() => scope.sockets.length === 1)
  scope.sockets[0]!.open()
  await opening
  return { scope, client }
}

describe('stable page client', () => {
  it('does not re-suspend a fresh participation when restoring after port loss', async () => {
    const visibility = lifecycle()
    const { scope, client } = await opened(true)
    visibility('hidden')
    scope.transports[0]!.fail(new SocketFuseError('WORKER_DISCONNECTED'))
    visibility('visible')
    await until(() => scope.transports.length === 2)
    await until(() => client.state === 'open' || scope.sockets.length === 2)
    scope.sockets[1]?.open()
    await until(() => client.state === 'open')
    scope.sockets.at(-1)!.message('after recovery')
    await until(() => client.data === 'after recovery')
  })

  it('does not let an older successful probe undo a newer suspension', async () => {
    const visibility = lifecycle()
    const { scope } = await opened(true)
    const port = scope.transports[0]!
    let settle: (() => void) | undefined
    vi.spyOn(port, 'probe').mockImplementation(() => new Promise((resolve) => {
      settle = resolve
    }))
    const notify = vi.spyOn(port, 'notify')
    visibility('hidden')
    visibility('visible')
    visibility('hidden')
    settle!()
    await Promise.resolve()
    await Promise.resolve()
    expect(notify.mock.calls.some(([message]) => message.type === 'restore')).toBe(false)
    visibility('visible')
    settle!()
    await until(() => notify.mock.calls.some(([message]) => message.type === 'restore'))
  })
  it('isolates both synchronous handler throws and rejected EventTarget callbacks', async () => {
    const { scope, client } = await opened()
    const received: unknown[] = []
    client.onMessage(() => {
      throw new Error('private')
    })
    client.onMessage((event) => {
      received.push(event.data)
    })
    client.addEventListener('message', (() => Promise.reject(new Error('private'))) as EventListener)
    const errors = vi.fn()
    client.addEventListener('error', errors)
    scope.sockets[0]!.message('one')
    await until(() => errors.mock.calls.length === 2)
    scope.sockets[0]!.message('two')
    await until(() => received.length === 2)
    expect(received).toEqual(['one', 'two'])
    expect(client.state).toBe('open')
  })

  it('updates data before handlers and dispatches EventTarget after all dynamic handlers', async () => {
    const { scope, client } = await opened()
    const order: string[] = []
    client.onMessage((event) => {
      expect(client.data).toBe(event.data)
      order.push('handler')
    })
    client.addEventListener('message', () => order.push('event'))
    scope.sockets[0]!.message('x')
    await until(() => order.length === 2)
    expect(order).toEqual(['handler', 'event'])
  })

  it('treats repeated dynamic registrations independently and obeys native once and signal', async () => {
    const { scope, client } = await opened()
    const callback = vi.fn()
    const event = vi.fn()
    const abort = new AbortController()
    const remove = client.onMessage(callback)
    client.onMessage(callback)
    client.addEventListener('message', event, { once: true })
    client.addEventListener('message', event, { once: true })
    const canceled = vi.fn()
    client.addEventListener('message', canceled, { signal: abort.signal })
    abort.abort()
    scope.sockets[0]!.message('one')
    await until(() => callback.mock.calls.length === 2)
    remove()
    scope.sockets[0]!.message('two')
    await until(() => callback.mock.calls.length === 3)
    expect(event).toHaveBeenCalledTimes(1)
    expect(canceled).not.toHaveBeenCalled()
  })

  it('allows every same-key local handler on the selected page and aborts its grant on close', async () => {
    const { scope, client } = await opened()
    const signals: AbortSignal[] = []
    client.onMessage((_event, context) => {
      signals.push(context.signal)
    }, { dispatchKey: 'effect' })
    client.onMessage((_event, context) => {
      signals.push(context.signal)
    }, { dispatchKey: 'effect' })
    await until(() => client.isDispatchOwner('effect'))
    scope.sockets[0]!.message('x')
    await until(() => signals.length === 2)
    expect(signals[0]).toBe(signals[1])
    await client.close()
    expect(signals[0]!.aborted).toBe(true)
    expect(client.isDispatchOwner('effect')).toBe(false)
  })

  it('notifies onConnected for each participant even when its socket is already open', async () => {
    const { scope } = await opened()
    const callback = vi.fn()
    const client = scope.client({ onConnected: callback })
    await client.open()
    expect(callback).toHaveBeenCalledTimes(1)
    await client.open()
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('does not leave an unresolved waiter when a connecting state listener synchronously closes', async () => {
    const scope = harness()
    scopes.push(scope)
    const client = scope.client()
    client.addEventListener('statechange', () => {
      if (client.state === 'connecting') void client.close()
    })
    await expect(client.open()).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    expect(scope.transports).toHaveLength(0)
  })

  it('keeps a newly opened participation when an old abort listener reenters open', async () => {
    const { scope, client } = await opened()
    let reopening: ReturnType<typeof client.open> | undefined
    client.onMessage((_event, context) => context.signal.addEventListener('abort', () => {
      reopening = client.open()
    }))
    scope.sockets[0]!.message('x')
    await until(() => client.data === 'x')
    await client.close()
    await until(() => scope.transports.length === 2)
    // idle timer 与新 attach 的先后都合法；无需求宽限内可以重用健康 socket。
    await until(() => scope.sockets.length === 2 || client.state === 'open')
    scope.sockets[1]?.open()
    await reopening
    expect(client.state).toBe('open')
    expect(scope.transports).toHaveLength(2)
  })

  it('rejects reconnect before participation and after close without manufacturing demand', async () => {
    const scope = harness()
    scopes.push(scope)
    const client = scope.client()
    await expect(client.reconnect()).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
    expect(scope.sockets).toHaveLength(0)
    const opening = client.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    await client.close()
    await expect(client.reconnect()).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
  })

  it('runs page preparation for explicit retries even with automatic recovery disabled', async () => {
    const scope = harness('direct')
    scopes.push(scope)
    const client = scope.client({ reconnect: { automatic: false, initialDelay: 1000 } })
    let context: BeforeReconnectContext | undefined
    client.onBeforeReconnect((value) => {
      context = value
      value.setOptions({ url: 'wss://updated.test/path' })
      value.setDelay(0)
    })
    const opening = client.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    await client.reconnect()
    await until(() => scope.sockets.length === 2)
    expect(context).toMatchObject({ source: 'page', countAsRetry: true, attempt: 2 })
    expect(scope.urls[1]).toBe('wss://updated.test/path')
    expect(context!.signal.aborted).toBe(true)
  })

  it('aborts a replaced hook and does not assign that plan to the replacement', async () => {
    const scope = harness()
    scopes.push(scope)
    const client = scope.client({ reconnect: { initialDelay: 0, hookTimeout: 100 } })
    let context: BeforeReconnectContext | undefined
    client.onBeforeReconnect((value) => {
      context = value
      return new Promise(() => {})
    })
    const opening = client.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    await client.reconnect()
    await until(() => context !== undefined)
    const replacement = vi.fn()
    client.onBeforeReconnect(replacement)
    expect(context!.signal.aborted).toBe(true)
    await until(() => scope.sockets.length === 2)
    expect(replacement).not.toHaveBeenCalled()
    expect(() => context!.setDelay(0)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
  })

  it('keeps opening even if initial dispatch registrations exceed the worker quota', async () => {
    const scope = harness('shared-worker', { workerLimits: { maxDispatchKeys: 1 } })
    scopes.push(scope)
    const client = scope.client()
    client.onMessage(() => {}, { dispatchKey: 'first' })
    client.onMessage(() => {}, { dispatchKey: 'second' })
    const errors = vi.fn()
    client.addEventListener('error', errors)
    const opening = client.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    await until(() => errors.mock.calls.length > 0)
    expect(client.state).toBe('open')
    await until(() => client.isDispatchOwner('first'))
    expect(client.isDispatchOwner('second')).toBe(false)
  })
})
