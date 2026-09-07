/** 验证连接扩展一次物理帧的协议效果、独立状态、准备授权和回收边界。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeforeReconnectContext, ProtocolAdapter, SocketData } from '../shared/types'
import { type ConnectionExtension, type ConnectionExtensionContext, type ConnectionExtensionFactory, defineWorkerProtocol } from '../runtime/protocol'
import { harness, until } from '../../test/fixtures'
import { rawProtocol } from '../protocol/adapter'

/** 每例拥有的运行时。 */
const scopes: ReturnType<typeof harness>[] = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose()
})

/** 打开测试连接，保留调用方自行注册业务函数的机会。 */
async function open(scope: ReturnType<typeof harness>, client = scope.client()): Promise<typeof client> {
  const opening = client.open()
  await until(() => scope.sockets.length > 0)
  scope.sockets[0]!.open()
  await opening
  return client
}

describe('connection-scoped protocol extension', () => {
  it('rejects opening before an asynchronous protocol initializer can announce readiness', async () => {
    const scope = harness('shared-worker', { createExtension: () => ({ onSocketOpen: () => Promise.reject(new Error('private initializer')) }) })
    scopes.push(scope)
    const connected = vi.fn()
    const client = scope.client({ onConnected: connected })
    const opening = client.open()
    const rejected = expect(opening).rejects.toMatchObject({ code: 'PROTOCOL_CONTRACT_VIOLATION' })
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await rejected
    expect(connected).not.toHaveBeenCalled()
    expect(client.state).toBe('failed')
  })
  it('creates one extension per epoch, uses safe context and disposes exactly once', async () => {
    const contexts: Readonly<ConnectionExtensionContext>[] = []
    const disposed = vi.fn()
    const opened = vi.fn()
    const scope = harness('shared-worker', { createExtension: (context) => {
      contexts.push(context)
      return { dispose: disposed, onSocketOpen: opened }
    } })
    scopes.push(scope)
    const a = await open(scope)
    const b = scope.client()
    await b.open()
    expect(contexts).toHaveLength(1)
    expect(contexts[0]).toMatchObject({ endpointOrigin: 'wss://example.test', attempt: 0 })
    expect(JSON.stringify(contexts)).not.toMatch(/socket|token/)
    expect(opened).toHaveBeenCalledTimes(1)
    await a.close()
    await b.close()
    await until(() => disposed.mock.calls.length === 1)
    const again = b.open()
    await until(() => scope.sockets.length === 2)
    scope.sockets[1]!.open()
    await again
    expect(contexts).toHaveLength(2)
    expect(contexts[1]!.connectionEpoch).not.toBe(contexts[0]!.connectionEpoch)
  })

  it('consumes custom business receipt frames and replies once for all tabs before fanout', async () => {
    const handled = vi.fn((frame: { data: unknown }) => ({ delivery: { type: 'consume' as const }, reply: 'received:' + String(frame.data) }))
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: handled }) })
    scopes.push(scope)
    const a = scope.client()
    const b = scope.client()
    const business = vi.fn()
    a.onMessage(business)
    b.onMessage(business)
    await open(scope, a)
    await b.open()
    scope.sockets[0]!.message('message-42')
    await until(() => handled.mock.calls.length === 1)
    expect(scope.sockets[0]!.sent).toEqual(['received:message-42'])
    expect(business).not.toHaveBeenCalled()
    expect(a.data).toBeNull()
    expect(b.data).toBeNull()
  })

  it('projects one independent clone per page and never waits for a business Promise', async () => {
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: frame => ({ delivery: { type: 'broadcast', data: { body: frame.data } }, reply: 'ack' }) }) })
    scopes.push(scope)
    const a = scope.client<{ body: string }>()
    const b = scope.client<{ body: string }>()
    const right: string[] = []
    a.onMessage((event) => {
      event.data.body = 'mutated'
      return new Promise(() => {})
    })
    b.onMessage((event) => {
      right.push(event.data.body)
    })
    const opening = a.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    await b.open()
    scope.sockets[0]!.message('one')
    scope.sockets[0]!.message('two')
    await until(() => right.length === 2)
    expect(right).toEqual(['one', 'two'])
    expect(scope.sockets[0]!.sent).toEqual(['ack', 'ack'])
  })

  it('does not broadcast a raw frame when protocol handling throws or returns an invalid result', async () => {
    let invalid = false
    const errors = vi.fn()
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: (() => {
      if (!invalid) throw new Error('private payload')
      return { delivery: { type: 'consume' }, unexpected: 'secret' }
    }) as NonNullable<ConnectionExtension['onFrame']> }) })
    scopes.push(scope)
    const a = scope.client({ onError: errors })
    const business = vi.fn()
    a.onMessage(business)
    await open(scope, a)
    scope.sockets[0]!.message('one')
    await until(() => errors.mock.calls.length === 1)
    invalid = true
    scope.sockets[0]!.message('two')
    await until(() => errors.mock.calls.length === 2)
    expect(business).not.toHaveBeenCalled()
    expect(scope.sockets[0]!.sent).toEqual([])
    expect(errors.mock.calls.map(call => call[1].message).join()).not.toMatch(/secret|private/)
    expect(a.state).toBe('open')
  })

  it('terminates on a thenable onFrame return and consumes its rejected Promise', async () => {
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: (() => Promise.reject(new Error('secret'))) as unknown as NonNullable<ConnectionExtension['onFrame']> }) })
    scopes.push(scope)
    const a = await open(scope)
    scope.sockets[0]!.message('x')
    await until(() => a.state === 'failed')
    await expect(a.reconnect({ countAsRetry: false })).rejects.toMatchObject({ code: 'PROTOCOL_CONTRACT_VIOLATION', fatal: true })
  })

  it('replies before reconnect and combines counted worker and automatic requests in one budget', async () => {
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: frame => ({ delivery: { type: 'consume' }, reply: 'ack', reconnect: { countAsRetry: frame.data !== 'free' } }) }) })
    scopes.push(scope)
    const a = scope.client({ reconnect: { initialDelay: 0, maxRetries: 1, stableThreshold: false } })
    await open(scope, a)
    scope.sockets[0]!.message('free')
    await until(() => scope.sockets.length === 2)
    expect(scope.sockets[0]!.sent).toEqual(['ack'])
    scope.sockets[1]!.open()
    await until(() => a.state === 'open')
    scope.sockets[1]!.closed()
    await until(() => scope.sockets.length === 3)
    scope.sockets[2]!.open()
    await until(() => a.diagnostics().attempt === 3 && a.state === 'open')
    await expect(a.reconnect()).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' })
    expect(scope.sockets[2]!.readyState).toBe(1)
  })

  it('never queues a reply across attempts when native backpressure prevents immediate send', async () => {
    const errors = vi.fn()
    const scope = harness('shared-worker', { createExtension: () => ({ onFrame: () => ({ delivery: { type: 'consume' }, reply: 'ack' }) }) })
    scopes.push(scope)
    const a = scope.client({ queue: true, onError: errors, backpressure: { highWaterMarkBytes: 10, lowWaterMarkBytes: 2 } })
    await open(scope, a)
    scope.sockets[0]!.bufferedAmount = 10
    scope.sockets[0]!.message('x')
    await until(() => errors.mock.calls.length > 0)
    scope.sockets[0]!.bufferedAmount = 0
    await a.sendMessage('business')
    expect(scope.sockets[0]!.sent).toEqual(['business'])
  })

  it('does not let per-page delivery quotas suppress protocol replies', async () => {
    const scope = harness('shared-worker', { workerLimits: { maxDeliveryBytes: 400 }, createExtension: () => ({ onFrame: () => ({ delivery: { type: 'broadcast', data: 'small' }, reply: 'ack' }) }) })
    scopes.push(scope)
    const a = await open(scope)
    scope.sockets[0]!.message('x')
    await until(() => scope.sockets[0]!.sent.length === 1)
    expect(scope.sockets[0]!.sent).toEqual(['ack'])
    expect(a.state).toBe('open')
  })

  it('gives worker preparation precedence and atomically changes the next URL and delay', async () => {
    let captured: BeforeReconnectContext | undefined
    const page = vi.fn()
    const scope = harness('shared-worker', { createExtension: () => ({ prepareAttempt: (context) => {
      captured = context
      context.setOptions({ url: 'wss://next.test/secret?token=hidden' })
      context.setDelay(0)
    } }) })
    scopes.push(scope)
    const a = scope.client({ reconnect: { initialDelay: 1000 } })
    a.onBeforeReconnect(page)
    await open(scope, a)
    expect(captured).toBeUndefined()
    await a.reconnect()
    await until(() => scope.sockets.length === 2)
    expect(scope.urls[1]).toBe('wss://next.test/secret?token=hidden')
    expect(page).not.toHaveBeenCalled()
    expect(captured!.signal.aborted).toBe(true)
    expect(() => captured!.setOptions({ url: 'wss://stale.test/' })).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
  })

  it('aborts synchronous preparation immediately when the hook disposes its runtime', async () => {
    let signal: AbortSignal | undefined
    let setterError: unknown
    const scope = harness('shared-worker', { createExtension: () => ({ prepareAttempt: (context) => {
      scope.runtime.dispose()
      signal = context.signal
      try {
        context.setDelay(0)
      }
      catch (error) {
        setterError = error
      }
    } }) })
    scopes.push(scope)
    const a = await open(scope)
    const reconnecting = a.reconnect().catch(error => error)
    await until(() => signal !== undefined)
    expect(signal!.aborted).toBe(true)
    expect(setterError).toMatchObject({ code: 'STALE_RECONNECT_PLAN' })
    expect(scope.sockets).toHaveLength(1)
    scope.transports[0]!.destroy()
    await reconnecting
  })

  it('does not start or charge a fallback retry when the last preparation owner leaves', async () => {
    const scope = harness()
    scopes.push(scope)
    const a = scope.client({ idleGraceMs: 100, reconnect: { initialDelay: 0 } })
    let context: BeforeReconnectContext | undefined
    a.onBeforeReconnect((value) => {
      context = value
      return new Promise(() => {})
    })
    await open(scope, a)
    await a.reconnect()
    await until(() => context !== undefined)
    await a.close()
    expect(context!.signal.aborted).toBe(true)
    expect(scope.sockets).toHaveLength(1)
  })

  it('does not resurrect a connection when an extension factory disposes the runtime', async () => {
    const disposed = vi.fn()
    let called = false
    const scope = harness('shared-worker', { createExtension: () => {
      called = true
      scope.runtime.dispose()
      return { dispose: disposed }
    } })
    scopes.push(scope)
    const a = scope.client()
    const opening = a.open().catch(error => error)
    await until(() => called)
    expect(scope.sockets).toHaveLength(0)
    expect(disposed).toHaveBeenCalledTimes(1)
    scope.transports[0]!.destroy()
    await opening
  })

  it.each([false, true])('rejects asynchronous custom factories without hiding the thenable in a binding (reject=%s)', async (reject) => {
    const registration = defineWorkerProtocol({ adapter: { ...rawProtocol, id: 'receipt' }, createExtension: (() => reject ? Promise.reject(new Error('secret')) : Promise.resolve({})) as unknown as ConnectionExtensionFactory<SocketData, SocketData> })
    const scope = harness('shared-worker', { protocols: [registration] })
    scopes.push(scope)
    const a = scope.client({ protocol: { type: 'custom', id: 'receipt', version: 1 }, worker: () => null as unknown as SharedWorker })
    await expect(a.open()).rejects.toMatchObject({ code: 'PROTOCOL_CONTRACT_VIOLATION' })
    expect(scope.sockets).toHaveLength(0)
  })

  it('pairs custom adapter types with projected business values and consumes control by default', async () => {
    const adapter: ProtocolAdapter<{ kind: string }, string> = { id: 'receipt', version: 1, encode: value => value, decode: value => ({ kind: String(value) }), classify: data => ({ type: data.kind === 'control' ? 'control' : 'data', data }) }
    const registration = defineWorkerProtocol({ adapter, createExtension: () => ({ onFrame: frame => ({ delivery: frame.type === 'control' ? { type: 'consume' } : { type: 'broadcast', data: frame.data.kind.length }, reply: 'ack' }) }) })
    const scope = harness('shared-worker', { protocols: [registration] })
    scopes.push(scope)
    const a = scope.client<number, string>({ protocol: { type: 'custom', id: 'receipt', version: 1 }, worker: () => null as unknown as SharedWorker })
    const incoming: number[] = []
    a.onMessage((event) => {
      incoming.push(event.data)
    })
    const opening = a.open()
    await until(() => scope.sockets.length === 1)
    scope.sockets[0]!.open()
    await opening
    scope.sockets[0]!.message('control')
    scope.sockets[0]!.message('business')
    await until(() => incoming.length === 1)
    expect(incoming).toEqual([8])
    expect(scope.sockets[0]!.sent).toEqual(['ack', 'ack'])
  })
})
