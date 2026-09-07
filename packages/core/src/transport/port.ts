/** 页面与统一 runtime 之间的原生端口客户端；短控制请求、发送结果未知和 lease 均按参与期拥有。 */
import type { ClientVisibility, SendOptions, SendReceipt, TimerHandle, WorkerResourceLimits } from '../shared/types'
import type { NormalizedWebSocketConfig } from '../config/normalize'
import { type Attached, type ClientControlMessage, type ControlResponseValue, isWorkerControlMessage, listenPort, type MessagePortLike, type Welcome, type WorkerControlMessage } from '../runtime/control'
import { CONTROL_PROTOCOL_MAJOR, CONTROL_RESPONSE_TIMEOUT, DEFAULT_WORKER_RESOURCE_LIMITS, MAX_PENDING_BYTES, MAX_PENDING_OPERATIONS } from '../shared/constants'
import { estimateStructuredCloneBytes } from '../shared/structured'
import { SocketFuseError } from '../shared/errors'

/** 在页面 waiter、attach 前发送和已 post 请求间共享的参与期预算。 */
export class OperationBudget {
  /** 正在等待结果的用户操作数。 */
  private count = 0
  /** 已接纳待决输入的预算，不等于 native bufferedAmount。 */
  private bytes = 0

  /** 先预留再分配/克隆，返回幂等释放函数。 */
  reserve(bytes = 0): () => void {
    if (!Number.isFinite(bytes) || bytes < 0 || this.count >= MAX_PENDING_OPERATIONS || this.bytes + bytes > MAX_PENDING_BYTES)
      throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED')
    this.count++
    this.bytes += bytes
    // 额度只归还一次，即使多个异常清理路径重叠。
    let released = false
    return () => {
      if (released)
        return
      released = true
      this.count--
      this.bytes -= bytes
    }
  }
}

/** 去掉由端口填入的身份字段，保留联合消息每个分支的必要字段。 */
type RequestInput<Value = ClientControlMessage> = Value extends { readonly requestId: string } ? Omit<Value, 'requestId' | 'sessionId'> : never
/** 不占用户 Promise 表的固定维护消息。 */
type NotificationInput<Value = ClientControlMessage> = Value extends { readonly requestId: string } ? never : Omit<Value, 'sessionId'>

/** 已 post 的一个短请求，只保留结算与计费信息，不持有业务 payload。 */
interface PendingRequest {
  /** 是否需要未知发送结果语义。 */
  readonly send: boolean
  /** 成功回复结算。 */
  readonly resolve: (value: ControlResponseValue) => void
  /** 安全拒绝结算。 */
  readonly reject: (error: SocketFuseError) => void
  /** 对应短期限。 */
  readonly timer: TimerHandle
  /** 归还本次用户或保留维护额度。 */
  readonly release: () => void
}

/** 一次 lease 确认使用发送时刻计时，不能由迟到响应延长本地有效期。 */
interface LeaseProbe {
  /** 本参与期单调序号。 */
  readonly sequence: number
  /** 发送墙钟时刻。 */
  readonly sentAt: number
  /** 发送单调时刻。 */
  readonly sentMonotonic: number
  /** 超时资源。 */
  readonly timer: TimerHandle
  /** 合并当前 probe 的 Promise。 */
  readonly promise: Promise<void>
  /** 完成当前确认。 */
  readonly resolve: () => void
  /** 确认失败。 */
  readonly reject: (error: SocketFuseError) => void
}

/** 返回当前 realm 的单调时间，缺失时退回墙钟并保持相同的保守检查。 */
function monotonicNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/** 只拥有一个端口参与期；稳定 client 负责 close 后创建新实例。 */
export class PortTransport {
  /** runtime 的实际静态能力，握手成功后替换默认预检查值。 */
  limits: Readonly<WorkerResourceLimits> = DEFAULT_WORKER_RESOURCE_LIMITS
  /** 成功握手的实例身份。 */
  instanceId = ''
  /** 是否已经完成 hello/welcome；用于错误分类，不控制页面永久 transport 选择。 */
  private welcomed = false
  /** 已提交 attach 的参与配置。 */
  private config: NormalizedWebSocketConfig | undefined
  /** 本参与期不可再次打开。 */
  private closed = false
  /** 短请求映射。 */
  private readonly pending = new Map<string, PendingRequest>()
  /** 短请求的单调序列。 */
  private sequence = 0
  /** 维护操作独立于用户预算，有固定上限。 */
  private maintenance = 0
  /** 端口事件解绑函数。 */
  private readonly cleanup: () => void
  /** Worker error 监听等选定通道资源。 */
  private readonly cleanups: (() => void)[] = []
  /** 当前唯一 lease 确认。 */
  private probing: LeaseProbe | undefined
  /** 周期 lease 的唯一 timer。 */
  private leaseTimer: TimerHandle | undefined
  /** lease 的单调发送序号。 */
  private leaseSequence = 0
  /** 最近确认对应的本地发送时刻。 */
  private confirmedAt = 0
  /** 同一确认的单调时刻。 */
  private confirmedMonotonic = 0
  /** 本地资格有效截止墙钟。 */
  private validUntil = 0
  /** 最近成功附着的 epoch。 */
  private epoch = ''

  /** 绑定新参与期，在调用方开始握手前就安装接收监听。 */
  constructor(readonly port: MessagePortLike, readonly sessionId: string, readonly kind: 'direct' | 'shared-worker',
    readonly workerMode: 'none' | 'inline' | 'custom', readonly budget: OperationBudget,
    private readonly onMessage: (message: WorkerControlMessage) => void,
    private readonly onFailure: (error: SocketFuseError) => void) {
    this.cleanup = listenPort(port, value => this.receive(value), () => this.fail(new SocketFuseError('WORKER_DISCONNECTED', { retryable: true })))
  }

  /** 追加属于本参与期的 Worker 或平台监听清理。 */
  addCleanup(cleanup: () => void): void {
    this.cleanups.push(cleanup)
  }

  /** 仅协商版本与静态能力；成功后由选择器永久提交 shared/direct。 */
  async handshake(): Promise<void> {
    // 握手或 attach 的已校验控制响应。
    const value = await this.request({ type: 'hello', protocolMajor: CONTROL_PROTOCOL_MAJOR }, true)
    if (value === null || !('kind' in value) || value.kind !== 'welcome')
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
    // 只从当前 Worker 握手取得控制资源上限。
    const welcome = value as Welcome
    if (welcome.protocolMajor !== CONTROL_PROTOCOL_MAJOR)
      throw new SocketFuseError('PROTOCOL_VERSION_MISMATCH')
    this.limits = welcome.limits
    this.instanceId = welcome.instanceId
    this.welcomed = true
  }

  /** 提交参与意图并立即取得当前快照，socket open 等待属于页面。 */
  async attach(config: NormalizedWebSocketConfig, visibility: ClientVisibility, dispatchKeys: readonly string[], reconnectHook: boolean): Promise<Attached> {
    this.config = config
    // 握手或 attach 的已校验控制响应。
    const value = await this.request({ type: 'attach', id: config.id, url: config.url, shared: config.shared,
      configCanonical: config.configCanonical, restore: config.local.lifecycle, visibility, dispatchKeys, reconnectHook }, true)
    if (value === null || !('kind' in value) || value.kind !== 'attached' || value.sessionId !== this.sessionId)
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
    this.epoch = value.snapshot.connectionEpoch
    void this.probe().catch(() => undefined)
    return value
  }

  /** 短控制请求，不把网络等待或页面业务 Promise 放入该表。 */
  request(message: RequestInput, maintenance = false, reserved?: () => void): Promise<ControlResponseValue> {
    return new Promise((resolve, reject) => {
      // 当前请求额度的清理能力。
      let release = reserved
      try {
        if (this.closed)
          throw new SocketFuseError('WORKER_DISCONNECTED')
        // 参与期内不复用的控制请求身份。
        const requestId = this.sessionId + ':' + ++this.sequence
        // 带上参与身份的完整控制输入。
        const envelope = { ...message, requestId, ...(message.type === 'hello' ? {} : { sessionId: this.sessionId }) }
        // 请求保留前按完整克隆图计费。
        const bytes = estimateStructuredCloneBytes(envelope, this.limits.maxControlEnvelopeBytes)
        if (bytes > this.limits.maxControlEnvelopeBytes)
          throw new SocketFuseError('MESSAGE_TOO_LARGE')
        if (release === undefined) {
          if (maintenance) {
            if (this.maintenance >= 4)
              throw new SocketFuseError('RESOURCE_LIMIT_EXCEEDED')
            this.maintenance++
            release = () => {
              this.maintenance--
            }
          }
          else {
            release = this.budget.reserve(bytes)
          }
        }
        // 请求的有界确认期限，不覆盖 socket 建连等待。
        const timer = globalThis.setTimeout(() => {
          // 只有仍在等待的请求可以被结算。
          const pending = this.pending.get(requestId)
          if (pending === undefined)
            return
          this.pending.delete(requestId)
          pending.release()
          pending.reject(new SocketFuseError(pending.send ? 'SEND_OUTCOME_UNKNOWN' : this.welcomed ? 'WORKER_DISCONNECTED' : 'WORKER_INIT_TIMEOUT', { retryable: true }))
        }, CONTROL_RESPONSE_TIMEOUT)
        this.pending.set(requestId, { resolve, reject, timer, release, send: message.type === 'send' })
        try {
          this.port.postMessage(envelope)
        }
        catch {
          this.pending.delete(requestId)
          globalThis.clearTimeout(timer)
          release()
          reject(new SocketFuseError('INVALID_CONTROL_MESSAGE'))
        }
      }
      catch (error) {
        release?.()
        reject(error instanceof SocketFuseError ? error : new SocketFuseError('INVALID_CONTROL_MESSAGE'))
      }
    })
  }

  /** 发送已预留预算的业务快照，不在成功 post 后保留原始对象。 */
  async send(data: unknown, options?: SendOptions, reserved?: () => void): Promise<SendReceipt> {
    // runtime 已确认的本地接纳结果。
    const result = await this.request({ type: 'send', data, ...(options === undefined ? {} : { options }) }, false, reserved)
    if (result === null || !('status' in result) || (result.status !== 'accepted' && result.status !== 'queued'))
      throw new SocketFuseError('INVALID_CONTROL_MESSAGE')
    return result
  }

  /** 保留维护通道，不借用用户操作额度。 */
  notify(message: NotificationInput): void {
    if (this.closed)
      return
    try {
      this.port.postMessage({ ...message, sessionId: this.sessionId })
    }
    catch {
      this.fail(new SocketFuseError('WORKER_DISCONNECTED', { retryable: true }))
    }
  }

  /** 合并唯一在途 lease/probe；迟到响应不能刷新为新的完整 TTL。 */
  probe(): Promise<void> {
    if (this.closed)
      return Promise.reject(new SocketFuseError('WORKER_DISCONNECTED'))
    if (this.probing !== undefined)
      return this.probing.promise
    // 本次 probe 的合并成功结算。
    let resolve!: () => void
    // 本次 probe 的合并失败结算。
    let reject!: (error: SocketFuseError) => void
    // 至多一个正在确认的租约 probe。
    const promise = new Promise<void>((done, failed) => {
      resolve = done
      reject = failed
    })
    // 参与期内单调的 lease 序号。
    const sequence = ++this.leaseSequence
    // 请求的有界确认期限，不覆盖 socket 建连等待。
    const timer = globalThis.setTimeout(() => {
      if (this.probing?.sequence === sequence)
        this.fail(new SocketFuseError('WORKER_DISCONNECTED', { retryable: true }))
    }, CONTROL_RESPONSE_TIMEOUT)
    this.probing = { sequence, timer, promise, resolve, reject, sentAt: Date.now(), sentMonotonic: monotonicNow() }
    this.notify({ type: 'lease', sequence })
    return promise
  }

  /** 派发入口按当前时间重新检查，不依赖 timer 已经执行。 */
  authorityValid(): boolean {
    // 自请求发送起的墙钟耗时，不能从响应到达时重新获得完整 TTL。
    const wall = Date.now() - this.confirmedAt
    // 单调时钟耗时用于拒绝墙钟跳变造成的虚假活性。
    const monotonic = monotonicNow() - this.confirmedMonotonic
    return !this.closed && this.validUntil > Date.now() && wall >= 0 && monotonic >= 0
      && Math.abs(wall - monotonic) < 1000 && monotonic < (this.config?.shared.lease.timeout ?? 0)
  }

  /** 明确 freeze/恢复屏障立即使资格失效，等待新的确认。 */
  invalidateAuthority(): void {
    this.validUntil = 0
    // 解除 probe 引用后再结算其等待者。
    const probing = this.probing
    this.probing = undefined
    if (probing !== undefined) {
      globalThis.clearTimeout(probing.timer)
      probing.reject(new SocketFuseError('ABORTED'))
    }
    if (this.leaseTimer !== undefined)
      globalThis.clearTimeout(this.leaseTimer)
    this.leaseTimer = undefined
  }

  /** 最多等待短 detach 回复，随后始终释放本地端口与所有监听。 */
  async close(): Promise<void> {
    if (this.closed)
      return
    try {
      if (this.config !== undefined)
        await this.request({ type: 'detach' }, true)
    }
    finally {
      this.destroy()
    }
  }

  /** 销毁不可复用参与期；已 post 发送使用结果未知而非伪装确认未发送。 */
  destroy(reason: SocketFuseError = new SocketFuseError('WORKER_DISCONNECTED', { retryable: true })): void {
    if (this.closed)
      return
    this.closed = true
    this.validUntil = 0
    this.cleanup()
    for (const cleanup of this.cleanups)
      cleanup()
    this.cleanups.length = 0
    this.config = undefined
    if (this.leaseTimer !== undefined)
      globalThis.clearTimeout(this.leaseTimer)
    this.leaseTimer = undefined
    // 解除 probe 引用后再结算其等待者。
    const probing = this.probing
    this.probing = undefined
    if (probing !== undefined) {
      globalThis.clearTimeout(probing.timer)
      probing.reject(new SocketFuseError('WORKER_DISCONNECTED'))
    }
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timer)
      pending.release()
      pending.reject(pending.send ? new SocketFuseError('SEND_OUTCOME_UNKNOWN', { retryable: true }) : reason)
    }
    this.pending.clear()
    this.port.close?.()
  }

  /** 选定通道失效只通知页面，永不在此处更换 transport。 */
  fail(error: SocketFuseError): void {
    if (this.closed)
      return
    this.destroy(error)
    this.onFailure(error)
  }

  /** 严格解析并处理回复，旧 session、旧请求和旧 lease 确认一律无效。 */
  private receive(value: unknown): void {
    if (this.closed)
      return
    if (!isWorkerControlMessage(value)) {
      this.fail(new SocketFuseError('INVALID_CONTROL_MESSAGE'))
      return
    }
    if (value.type === 'response') {
      // 只有仍在等待的请求可以被结算。
      const pending = this.pending.get(value.requestId)
      if (pending === undefined)
        return
      this.pending.delete(value.requestId)
      globalThis.clearTimeout(pending.timer)
      pending.release()
      if (value.ok)
        pending.resolve(value.value)
      else
        pending.reject(new SocketFuseError(value.error.code, { fatal: value.error.fatal, retryable: value.error.retryable }))
      return
    }
    if (value.sessionId !== this.sessionId)
      return
    if (value.type === 'lease-confirmed') {
      // 解除 probe 引用后再结算其等待者。
      const probing = this.probing
      if (probing === undefined || probing.sequence !== value.sequence || value.connectionEpoch !== this.epoch)
        return
      this.probing = undefined
      globalThis.clearTimeout(probing.timer)
      this.confirmedAt = probing.sentAt
      this.confirmedMonotonic = probing.sentMonotonic
      this.validUntil = probing.sentAt + (this.config?.shared.lease.timeout ?? 0)
      if (!this.authorityValid()) {
        this.validUntil = 0
        probing.reject(new SocketFuseError('WORKER_DISCONNECTED', { retryable: true }))
        this.fail(new SocketFuseError('WORKER_DISCONNECTED', { retryable: true }))
        return
      }
      probing.resolve()
      if (this.leaseTimer !== undefined)
        globalThis.clearTimeout(this.leaseTimer)
      this.leaseTimer = globalThis.setTimeout(() => {
        this.leaseTimer = undefined
        void this.probe().catch(() => undefined)
      }, this.config?.shared.lease.interval ?? CONTROL_RESPONSE_TIMEOUT)
    }
    if (value.type === 'message') {
      if (estimateStructuredCloneBytes(value, this.limits.maxDeliveryBytes) > this.limits.maxDeliveryBytes) {
        this.fail(new SocketFuseError('MESSAGE_TOO_LARGE'))
        return
      }
      // 表示页面传输层已取走 envelope，不是页面业务成功或其 Promise 完成。
      this.notify({ type: 'receipt', deliveryId: value.deliveryId })
    }
    this.onMessage(value)
  }
}
