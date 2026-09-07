/** 从物理引擎边界验证代际、原子准备、预算、心跳与同步发送，避免页面调度掩盖重入。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CreateWebSocketOptions, ProtocolAdapter, SocketData } from '../shared/types'
import { ConnectionController, type ConnectionControllerOptions, type ReconnectPlan } from './controller'
import { normalizeWebSocketOptions } from '../config/normalize'
import { rawProtocol } from '../protocol/adapter'
import { FakeSocket } from '../../test/fixtures'

/** 每个测试拥有的控制器，结束时串行释放。 */
const controllers: ConnectionController<SocketData, SocketData>[] = []
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose()
  vi.useRealTimers()
})

/** 建立不含端口的同步物理引擎与工厂记录。 */
function engine(settings: Partial<CreateWebSocketOptions> = {}, overrides: Partial<ConnectionControllerOptions<SocketData, SocketData>> = {}) {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const controller = new ConnectionController({ config: normalizeWebSocketOptions('wss://example.test/secret?token=secret', {
    id: 'room', reconnect: { initialDelay: 0, jitter: 0, stableThreshold: false }, ...settings,
  }), connectionEpoch: 'epoch', adapter: rawProtocol, socketFactory: (url) => {
    urls.push(url)
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket
  }, ...overrides })
  controllers.push(controller)
  return { controller, sockets, urls }
}

describe('physical connection engine', () => {
  it('rejects async encode as a fatal contract violation without creating an outgoing tail', () => {
    const adapter = { ...rawProtocol, encode: (() => Promise.resolve('late')) as unknown as ProtocolAdapter<SocketData, SocketData>['encode'] }
    const { controller, sockets } = engine({}, { adapter })
    controller.setDemand(true)
    sockets[0]!.open()
    expect(() => controller.send('owner', 'x')).toThrowError(expect.objectContaining({ code: 'PROTOCOL_CONTRACT_VIOLATION', fatal: true }))
    expect(sockets[0]!.sent).toEqual([])
    expect(controller.state).toBe('failed')
    expect(() => controller.requestReconnect('page', false)).toThrowError(expect.objectContaining({ fatal: true }))
  })

  it('rejects thenable decode and ignores all old callbacks after a replacement', () => {
    const onFrame = vi.fn()
    const scope = engine({}, { observer: { onFrame } })
    const { controller, sockets } = scope
    controller.setDemand(true)
    sockets[0]!.open()
    const oldMessages = sockets[0]!.callbacks('message')
    const oldClose = sockets[0]!.callbacks('close')
    const oldOpen = sockets[0]!.callbacks('open')
    controller.requestReconnect('page')
    sockets[1]!.open()
    for (const callback of oldMessages) callback({ data: 'late' })
    for (const callback of oldClose) callback({ code: 1006 })
    for (const callback of oldOpen) callback({})
    expect(controller.snapshot()).toMatchObject({ state: 'open', attempt: 2 })
    expect(onFrame).not.toHaveBeenCalled()
    expect(sockets).toHaveLength(2)
  })

  it('checks the attempt again after encode invokes an external close', () => {
    let close = (): void => undefined
    const adapter = { ...rawProtocol, encode: (value: SocketData) => {
      close()
      return value
    } }
    const { controller, sockets } = engine({ queue: false }, { adapter })
    controller.setDemand(true)
    sockets[0]!.open()
    close = () => controller.setDemand(false)
    expect(() => controller.send('owner', 'x')).toThrowError(expect.objectContaining({ code: 'CLIENT_DISCONNECTED' }))
    expect(sockets[0]!.sent).toEqual([])
  })

  it('does not return accepted or consume the queue when injected native send invalidates the attempt', () => {
    const { controller, sockets } = engine({ queue: true, reconnect: { automatic: false } })
    controller.setDemand(true)
    sockets[0]!.open()
    sockets[0]!.afterSend = () => sockets[0]!.closed(1000)
    expect(() => controller.send('owner', 'x')).toThrowError(expect.objectContaining({ code: 'SOCKET_ERROR' }))
    expect(controller.state).toBe('closed')
  })

  it('charges a throwing socket factory at the unique attempt-start point', () => {
    vi.useFakeTimers()
    const factory = vi.fn(() => {
      throw new Error('secret')
    })
    const { controller } = engine({ reconnect: { maxRetries: 2, initialDelay: 5, jitter: 0, stableThreshold: false } }, { socketFactory: factory })
    controller.setDemand(true)
    vi.advanceTimersByTime(100)
    expect(factory).toHaveBeenCalledTimes(3)
    expect(controller.diagnostics()).toMatchObject({ attempt: 3, retriesUsed: 2, retriesRemaining: 0, lastErrorCode: 'RETRY_EXHAUSTED' })
  })

  it('cancels before ending a healthy attempt when state notification removes the final demand', () => {
    let cancel = (): void => undefined
    const { controller, sockets } = engine({}, { observer: { onState: (snapshot) => {
      if (snapshot.state === 'reconnecting') cancel()
    } } })
    controller.setDemand(true)
    sockets[0]!.open()
    cancel = () => {
      controller.setDemand(false)
    }
    controller.requestReconnect('page')
    expect(sockets[0]!.readyState).toBe(1)
    expect(controller.isCurrentAttempt(1)).toBe(true)
    expect(controller.state).toBe('open')
    expect(controller.diagnostics().retryReserved).toBe(0)
  })

  it('finishes native close if onClose cancels a newly reserved plan', () => {
    let cancel = (): void => undefined
    const { controller, sockets } = engine({}, { observer: { onClose: () => cancel() } })
    controller.setDemand(true)
    sockets[0]!.open()
    cancel = () => {
      controller.setDemand(false)
    }
    controller.requestReconnect('page')
    expect(sockets).toHaveLength(1)
    expect(sockets[0]!.readyState).toBe(3)
    expect(controller.diagnostics().retriesUsed).toBe(0)
  })

  it('holds the previous socket until native CLOSED and rejects stale plan observations', () => {
    const { controller, sockets } = engine()
    controller.setDemand(true)
    sockets[0]!.open()
    sockets[0]!.deferClose = true
    controller.requestReconnect('page')
    expect(sockets).toHaveLength(1)
    sockets[0]!.closed()
    sockets[1]!.open()
    expect(() => controller.requestReconnect('page', true, { connectionEpoch: 'epoch', attempt: 1, planId: null })).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
    expect(sockets[1]!.readyState).toBe(1)
  })

  it('validates an entire URL/delay draft before replacing the endpoint', () => {
    vi.useFakeTimers()
    let plan: ReconnectPlan | undefined
    const { controller, urls, sockets } = engine({}, { observer: { onPrepare: (value) => {
      plan = value
      return true
    } } })
    controller.setDemand(true)
    sockets[0]!.open()
    controller.requestReconnect('page')
    expect(() => controller.commitReconnectPlan(plan!.id, { url: 'wss://next.test/new', delay: -1 })).toThrowError()
    expect(controller.endpointUrl).toContain('example.test')
    controller.commitReconnectPlan(plan!.id, { url: 'wss://next.test/new', delay: 20 })
    vi.advanceTimersByTime(19)
    expect(urls).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(urls[1]).toBe('wss://next.test/new')
    expect(controller.diagnostics().endpointOrigin).toBe('wss://next.test')
    expect(() => controller.commitReconnectPlan(plan!.id, { url: 'wss://stale.test' })).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
  })

  it('keeps spent counts on explicit uncounted retries and does not close on exhausted counted requests', () => {
    const { controller, sockets } = engine({ reconnect: { maxRetries: 1, initialDelay: 0, stableThreshold: false } })
    controller.setDemand(true)
    sockets[0]!.open()
    controller.requestReconnect('page')
    sockets[1]!.open()
    expect(() => controller.requestReconnect('worker')).toThrowError(expect.objectContaining({ code: 'RETRY_EXHAUSTED' }))
    expect(sockets[1]!.readyState).toBe(1)
    controller.requestReconnect('worker', false)
    sockets[2]!.open()
    expect(controller.diagnostics()).toMatchObject({ retriesUsed: 1, attempt: 3 })
  })

  it('does not count disconnected time toward the stable window', () => {
    vi.useFakeTimers()
    const { controller, sockets } = engine({ reconnect: { initialDelay: 100, jitter: 0, stableThreshold: 50 } })
    controller.setDemand(true)
    sockets[0]!.open()
    vi.advanceTimersByTime(20)
    sockets[0]!.closed()
    vi.advanceTimersByTime(100)
    sockets[1]!.open()
    expect(controller.diagnostics().retriesUsed).toBe(1)
    vi.advanceTimersByTime(49)
    expect(controller.diagnostics().retriesUsed).toBe(1)
    vi.advanceTimersByTime(1)
    expect(controller.diagnostics().retriesUsed).toBe(0)
  })

  it.each([['ping', 'pong'], [new Uint8Array([1]), new Uint8Array([2])]] as const)('uses raw heartbeat wire equality and consumes pong', (message, responseMessage) => {
    vi.useFakeTimers()
    const onFrame = vi.fn()
    const { controller, sockets } = engine({ heartbeat: { interval: 10, pongTimeout: 5, message, responseMessage } }, { observer: { onFrame } })
    controller.setDemand(true)
    sockets[0]!.open()
    vi.advanceTimersByTime(10)
    expect(sockets[0]!.sent).toEqual([message])
    sockets[0]!.message(responseMessage)
    vi.advanceTimersByTime(5)
    expect(sockets).toHaveLength(1)
    expect(onFrame).not.toHaveBeenCalled()
  })

  it('routes heartbeat timeouts through the same shared budget', () => {
    vi.useFakeTimers()
    const { controller, sockets } = engine({ heartbeat: { interval: 10, pongTimeout: 5 }, reconnect: { maxRetries: 1, initialDelay: 0 } })
    controller.setDemand(true)
    sockets[0]!.open()
    vi.advanceTimersByTime(15)
    expect(sockets).toHaveLength(2)
    expect(controller.diagnostics()).toMatchObject({ retriesUsed: 1, lastErrorCode: 'HEARTBEAT_TIMEOUT' })
  })

  it('rejects a partial extension heartbeat group without createPing even for raw', () => {
    const { controller } = engine({ heartbeat: true })
    expect(() => controller.setHeartbeatGenerators({ createPong: () => 'pong' })).toThrowError(expect.objectContaining({ code: 'INVALID_OPTIONS' }))
  })

  it('never exposes path, query credentials or internal exception text in diagnostics', () => {
    const { controller } = engine({}, { socketFactory: () => {
      throw new Error('very-secret')
    } })
    controller.setDemand(true)
    const result = JSON.stringify(controller.diagnostics())
    expect(result).not.toMatch(/token|secret/)
    expect(controller.diagnostics().endpointOrigin).toBe('wss://example.test')
  })
})
