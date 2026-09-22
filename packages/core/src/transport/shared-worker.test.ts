/** 验证 transport 一次性选择：只有内联初始化失败可降级 direct，已提交 shared 后不得改变接入。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MessagePortLike } from '../runtime/control'
import { createTransportSelector, type SharedWorkerLike, type TransportParticipant } from './shared-worker'
import { CONTROL_PROTOCOL_MAJOR, DEFAULT_WORKER_RESOURCE_LIMITS } from '../shared/constants'
import { OperationBudget, type PortTransport } from './port'
import { SocketFuseError } from '../shared/errors'

/** 测试所有者持有的端口，结束时必须销毁以释放监听与待决请求。 */
const transports: PortTransport[] = []
afterEach(() => {
  for (const transport of transports.splice(0)) transport.destroy()
  vi.useRealTimers()
})

/** 握手回复方式：正常 welcome、永不回复以触发期限、或不合法控制响应。 */
type ReplyMode = 'welcome' | 'silent' | 'invalid'

/** 可控 SharedWorker 端口替身，只回复 hello，不实现连接语义。 */
class FakeWorkerPort implements MessagePortLike {
  private readonly listeners = new Map<string, Set<(event: { readonly data: unknown }) => void>>()

  constructor(private readonly reply: ReplyMode) {}

  postMessage(message: unknown): void {
    const request = message as { readonly type: string, readonly requestId: string }
    if (request.type !== 'hello' || this.reply === 'silent')
      return
    // 不合法响应用 null 触发 INVALID_CONTROL_MESSAGE，它不属于允许降级的初始化失败。
    const value = this.reply === 'invalid'
      ? null
      : { kind: 'welcome', instanceId: 'runtime', protocolMajor: CONTROL_PROTOCOL_MAJOR, limits: DEFAULT_WORKER_RESOURCE_LIMITS }
    queueMicrotask(() => this.emit({ type: 'response', requestId: request.requestId, ok: true, value }))
  }

  addEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    const existing = this.listeners.get(type) ?? new Set()
    existing.add(listener)
    this.listeners.set(type, existing)
  }

  removeEventListener(type: 'message' | 'messageerror', listener: (event: { readonly data: unknown }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  close(): void {
    this.listeners.clear()
  }

  /** 向页面侧派发一条已构造的控制消息。 */
  private emit(data: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }
}

/** 记录选择与失败通知的参与期替身；每次选择必须使用独立实例。 */
function participant(sessionId = 'session-1') {
  const failures: SocketFuseError[] = []
  const selected: { kind: string, mode: string }[] = []
  const value: TransportParticipant & { readonly failures: SocketFuseError[], readonly selected: typeof selected } = {
    budget: new OperationBudget(),
    failures,
    onFailure: error => failures.push(error),
    onMessage: () => undefined,
    onSelected: (kind, mode) => selected.push({ kind, mode }),
    selected,
    sessionId,
  }
  return value
}

/** 建立一个握手行为固定的 Worker 替身；`onError` 在注册后立即触发加载失败。 */
function worker(reply: ReplyMode, failAfterListen = false): SharedWorkerLike {
  const port = new FakeWorkerPort(reply)
  return {
    addEventListener: (_type, listener) => {
      if (failAfterListen)
        queueMicrotask(() => listener(undefined))
    },
    port,
    removeEventListener: () => undefined,
  }
}

/** 运行一次选择并记录端口，便于统一销毁。 */
async function select(selector: ReturnType<typeof createTransportSelector>, current = participant()): Promise<void> {
  transports.push(await selector(current))
}

describe('transport selector', () => {
  it('falls back to direct when the platform lacks SharedWorker', async () => {
    const selector = createTransportSelector(() => {
      throw new SocketFuseError('WORKER_UNSUPPORTED')
    }, 'inline', 'direct')
    const current = participant()
    await select(selector, current)
    expect(current.selected).toEqual([{ kind: 'direct', mode: 'none' }])
    expect(current.failures).toEqual([])
  })

  it('maps an unknown construction throw to a fallback-eligible failure', async () => {
    const selector = createTransportSelector(() => {
      throw new Error('boom')
    }, 'inline', 'direct')
    const current = participant()
    await select(selector, current)
    expect(current.selected).toEqual([{ kind: 'direct', mode: 'none' }])
  })

  it('treats a malformed worker port as a construction failure', async () => {
    const selector = createTransportSelector(() => ({ port: {} as MessagePortLike }), 'inline', 'direct')
    const current = participant()
    await select(selector, current)
    expect(current.selected).toEqual([{ kind: 'direct', mode: 'none' }])
  })

  it('falls back to direct when the worker fails to load before welcome', async () => {
    const selector = createTransportSelector(() => worker('silent', true), 'inline', 'direct')
    const current = participant()
    await select(selector, current)
    expect(current.selected).toEqual([{ kind: 'direct', mode: 'none' }])
    // 构造窗口内的加载失败由选择器结算，不通知尚未提交接入的页面。
    expect(current.failures).toEqual([])
  })

  it('falls back to direct when the handshake never completes', async () => {
    vi.useFakeTimers()
    const selector = createTransportSelector(() => worker('silent'), 'inline', 'direct')
    const current = participant()
    const pending = selector(current)
    await vi.advanceTimersByTimeAsync(5_000)
    transports.push(await pending)
    expect(current.selected).toEqual([{ kind: 'direct', mode: 'none' }])
  })

  it('rejects instead of degrading when fallback is disabled', async () => {
    const selector = createTransportSelector(() => {
      throw new SocketFuseError('WORKER_UNSUPPORTED')
    }, 'inline', 'error')
    const current = participant()
    await expect(selector(current)).rejects.toThrowError(expect.objectContaining({ code: 'WORKER_UNSUPPORTED' }))
    expect(current.selected).toEqual([])
  })

  it('never degrades a custom deployment that would lose its worker logic', async () => {
    const selector = createTransportSelector(() => {
      throw new Error('boom')
    }, 'custom', 'direct')
    const current = participant()
    await expect(selector(current)).rejects.toThrowError(expect.objectContaining({ code: 'WORKER_CONSTRUCTION_FAILED' }))
    expect(current.selected).toEqual([])
  })

  it('does not degrade on a failure outside the initialization codes', async () => {
    const selector = createTransportSelector(() => worker('invalid'), 'inline', 'direct')
    const current = participant()
    await expect(selector(current)).rejects.toThrowError(expect.objectContaining({ code: 'INVALID_CONTROL_MESSAGE' }))
    expect(current.selected).toEqual([])
  })

  it('keeps shared for later participations once the handshake committed it', async () => {
    // 第二次构造失败使用与首次相同的平台故障，只有 chosen 的差异决定结果。
    let attempts = 0
    const selector = createTransportSelector(() => {
      attempts++
      if (attempts > 1)
        throw new SocketFuseError('WORKER_UNSUPPORTED')
      return worker('welcome')
    }, 'inline', 'direct')
    const first = participant('session-1')
    await select(selector, first)
    expect(first.selected).toEqual([{ kind: 'shared-worker', mode: 'inline' }])

    const second = participant('session-2')
    await expect(selector(second)).rejects.toThrowError(expect.objectContaining({ code: 'WORKER_UNSUPPORTED' }))
    expect(second.selected).toEqual([])
  })

  it('reuses direct without constructing a worker again', async () => {
    let attempts = 0
    const selector = createTransportSelector(() => {
      attempts++
      throw new SocketFuseError('WORKER_UNSUPPORTED')
    }, 'inline', 'direct')
    await select(selector, participant('session-1'))
    const second = participant('session-2')
    await select(selector, second)
    expect(second.selected).toEqual([{ kind: 'direct', mode: 'none' }])
    expect(attempts).toBe(1)
  })

  it('reports a post-handshake worker failure without changing the selection', async () => {
    // 保留已注册的运行期 error 监听，握手完成后再触发。
    let notify: ((event: unknown) => void) | undefined
    const selector = createTransportSelector(() => ({
      addEventListener: (_type, listener) => {
        notify = listener
      },
      port: new FakeWorkerPort('welcome'),
      removeEventListener: () => undefined,
    }), 'inline', 'direct')
    const current = participant()
    await select(selector, current)
    expect(current.selected).toEqual([{ kind: 'shared-worker', mode: 'inline' }])
    notify?.(undefined)
    expect(current.failures.map(error => error.code)).toEqual(['WORKER_DISCONNECTED'])
    expect(current.selected).toEqual([{ kind: 'shared-worker', mode: 'inline' }])
  })
})
