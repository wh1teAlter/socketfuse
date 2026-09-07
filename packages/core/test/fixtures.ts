/** 通过真实 MessageChannel 和可控 socket 在页面 client 边界验证两种接入的共同契约。 */
import type { CreateWebSocketOptions, SocketData } from '../src/shared/types'
import type { MessagePortLike } from '../src/runtime/control'
import type { WebSocketLike } from '../src/connection/socket'
import { type ConnectionRuntime, type ConnectionRuntimeOptions, createConnectionRuntime } from '../src/runtime/host'
import { normalizeWebSocketOptions } from '../src/config/normalize'
import { PageWebSocketClient } from '../src/page/client'
import { PortTransport } from '../src/transport/port'

/** 可以延迟关闭、抛发送异常和重放过期事件的原生 socket 替身。 */
export class FakeSocket implements WebSocketLike {
  /** 原生入站表示。 */
  binaryType: 'arraybuffer' | 'blob' = 'arraybuffer'
  /** 测试背压。 */
  bufferedAmount = 0
  /** 可控原生状态。 */
  readyState = 0
  /** 实际交给 native send 的 wire。 */
  readonly sent: SocketData[] = []
  /** 当前注册监听。 */
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  /** 是否在 native send 抛出。 */
  failSend = false
  /** 是否等待测试确认 close。 */
  deferClose = false
  /** native close 调用数。 */
  closeCalls = 0
  /** 每次 send 后可模拟背压或同步重入。 */
  afterSend: (() => void) | undefined

  /** 添加原生事件。 */
  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  /** 删除原生事件。 */
  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  /** 记录本地接纳 wire，不代表网络送达。 */
  send(data: SocketData): void {
    if (this.failSend || this.readyState !== 1)
      throw new Error('secret native send failure')
    this.sent.push(data)
    this.afterSend?.()
  }

  /** 请求关闭；延迟模式用于证明不会并行构造第二个 socket。 */
  close(code = 1000): void {
    this.closeCalls++
    this.readyState = 2
    if (!this.deferClose)
      this.closed(code)
  }

  /** 确认原生关闭。 */
  closed(code = 1006): void {
    this.readyState = 3
    this.emit('close', { code, wasClean: code === 1000 })
  }

  /** 确认原生打开。 */
  open(): void {
    this.readyState = 1
    this.emit('open', {})
  }

  /** 注入原生入站消息。 */
  message(data: SocketData): void {
    this.emit('message', { data })
  }

  /** 注入错误事件。 */
  error(): void {
    this.emit('error', {})
  }

  /** 取得旧监听副本，验证解除注册也不能取代代际守卫。 */
  callbacks(type: string): readonly ((event: unknown) => void)[] {
    return [...this.listeners.get(type) ?? []]
  }

  /** 分发可控事件。 */
  private emit(type: string, event: unknown): void {
    for (const listener of this.callbacks(type)) listener(event)
  }
}

/** 等待真实端口与浏览器任务，不把测试框架微任务顺序冒充 MessagePort 调度。 */
export async function until(predicate: () => boolean, timeout = 1500): Promise<void> {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for observable behavior')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
}

/** 测试运行时拥有的可观察 seam 与清理入口。 */
export interface TestHarness {
  /** 已启动的物理 socket。 */
  readonly sockets: FakeSocket[]
  /** 工厂实际接收的 endpoint，仅测试断言使用。 */
  readonly urls: string[]
  /** 本例统一运行时。 */
  readonly runtime: ConnectionRuntime
  /** 页面参与期端口。 */
  readonly transports: PortTransport[]
  /** 创建尚未参与的页面。 */
  readonly client: <Incoming = SocketData, Outgoing = SocketData>(options?: Partial<CreateWebSocketOptions<Incoming, Outgoing>>, url?: string) => PageWebSocketClient<Incoming, Outgoing>
  /** 串行清理本例拥有的资源。 */
  readonly dispose: () => Promise<void>
}

/** 创建可由多个页面 client 共享的测试 runtime。 */
export function harness(kind: 'shared-worker' | 'direct' = 'shared-worker', options: ConnectionRuntimeOptions = {}): TestHarness {
  const sockets: FakeSocket[] = []
  const urls: string[] = []
  const runtime = createConnectionRuntime({ ...options, socketFactory: (url) => {
    urls.push(url)
    const socket = new FakeSocket()
    sockets.push(socket)
    return socket
  } })
  const clients: PageWebSocketClient<unknown, unknown>[] = []
  const transports: PortTransport[] = []
  return { sockets, urls, runtime, transports,
    /** 建立只拥有本地意图、尚未打开的 client。 */
    client<Incoming = SocketData, Outgoing = SocketData>(options: Partial<CreateWebSocketOptions<Incoming, Outgoing>> & { readonly id?: string } = {}, url = 'wss://example.test/socket'): PageWebSocketClient<Incoming, Outgoing> {
      const settings: CreateWebSocketOptions<Incoming, Outgoing> = { id: 'room', immediate: false, idleGraceMs: 0, ...options }
      const config = normalizeWebSocketOptions(url, settings)
      const client = new PageWebSocketClient(config, settings, async (participant) => {
        const channel = new MessageChannel()
        runtime.connect(channel.port2 as unknown as MessagePortLike)
        const port = new PortTransport(channel.port1 as unknown as MessagePortLike, participant.sessionId, kind,
          kind === 'direct' ? 'none' : config.local.workerMode, participant.budget, participant.onMessage, participant.onFailure)
        transports.push(port)
        await port.handshake()
        participant.onSelected(kind, kind === 'direct' ? 'none' : config.local.workerMode)
        return port
      })
      clients.push(client as unknown as PageWebSocketClient<unknown, unknown>)
      return client
    },
    /** 终结测试所有资源，未打开 client 也不遗留默认 timer。 */
    async dispose(): Promise<void> {
      for (const client of clients)
        await client.dispose().catch(() => undefined)
      for (const port of transports)
        port.destroy()
      for (const socket of sockets) {
        socket.deferClose = false
        if (socket.readyState !== 3)
          socket.closed()
      }
      runtime.dispose()
    },
  }
}
