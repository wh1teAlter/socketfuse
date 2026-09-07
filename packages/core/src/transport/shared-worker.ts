/** 惰性创建端口并一次性提交 transport 选择；成功 shared 握手之后不再有 direct 分支。 */
import type { MessagePortLike, WorkerControlMessage } from '../runtime/control'
import { type OperationBudget, PortTransport } from './port'
import { SocketFuseError } from '../shared/errors'
import { createDirectPort } from './direct'

/** SharedWorker 最小平台能力，便于真实端口的契约测试。 */
export interface SharedWorkerLike {
  /** 浏览器创建的页面端口。 */
  readonly port: MessagePortLike
  /** 加载/执行错误监听；事件原始文本从不进入公开错误。 */
  addEventListener?: (type: 'error', listener: (event: unknown) => void) => void
  /** 错误监听清理。 */
  removeEventListener?: (type: 'error', listener: (event: unknown) => void) => void
}

/** 每次参与期重建所需的稳定页面接收者。 */
export interface TransportParticipant {
  /** 新的不可复用参与期。 */
  readonly sessionId: string
  /** 与页面 waiter/未 post 发送共用的操作额度。 */
  readonly budget: OperationBudget
  /** 当前参与期的有序控制事件。 */
  readonly onMessage: (message: WorkerControlMessage) => void
  /** 已选通道失败的安全通知。 */
  readonly onFailure: (error: SocketFuseError) => void
  /** 握手后立即报告永久选择，不等待 socket 建连。 */
  readonly onSelected: (kind: 'shared-worker' | 'direct', mode: 'inline' | 'custom' | 'none') => void
}

/** 新参与期端口的惰性选择工厂。 */
export type TransportSelector = (participant: TransportParticipant) => Promise<PortTransport>

/** 允许尚未选定 transport 的内联部署进行 direct fallback 的明确初始化失败。 */
const fallbackCodes = new Set(['WORKER_UNSUPPORTED', 'WORKER_CONSTRUCTION_FAILED', 'WORKER_LOAD_FAILED', 'WORKER_INIT_TIMEOUT'])

/**
 * 建立稳定 client 所有的选择器；close 和 Worker 恢复只重建端口，不重置 chosen。
 * @param createWorker 惰性 Worker 工厂；不能在 client 构造期间调用。
 * @param mode 内联或自定义部署。
 * @param fallback 已校验的初始化失败策略。
 * @returns 每次建立新端口参与期的异步工厂。
 */
export function createTransportSelector(createWorker: () => SharedWorkerLike, mode: 'inline' | 'custom', fallback: 'direct' | 'error'): TransportSelector {
  // 首次成功选择后固定的接入方式，恢复不能重新降级。
  let chosen: 'shared-worker' | 'direct' | undefined
  return async (participant) => {
    /** 已选通道的失败才通知稳定页面，初始化候选的失败先由选择器结算。 */
    const failure = (error: SocketFuseError): void => {
      if (chosen !== undefined)
        participant.onFailure(error)
    }
    /** direct 和 shared 同样完成能力握手，避免引入第三种同步行为。 */
    const direct = async (): Promise<PortTransport> => {
      // 当前参与期的端口传输，不复用旧 port。
      const transport = new PortTransport(createDirectPort(), participant.sessionId, 'direct', 'none', participant.budget, participant.onMessage, failure)
      try {
        await transport.handshake()
        chosen = 'direct'
        participant.onSelected('direct', 'none')
        return transport
      }
      catch (error) {
        transport.destroy()
        throw error
      }
    }
    if (chosen === 'direct')
      return direct()
    // 当前参与期的端口传输，不复用旧 port。
    let transport: PortTransport | undefined
    try {
      // 调用页面工厂创建的共享 Worker 句柄。
      let worker: SharedWorkerLike
      try {
        worker = createWorker()
      }
      catch (error) {
        if (error instanceof SocketFuseError && error.code === 'WORKER_UNSUPPORTED')
          throw error
        throw new SocketFuseError('WORKER_CONSTRUCTION_FAILED')
      }
      if (typeof worker?.port?.postMessage !== 'function' || typeof worker.port.addEventListener !== 'function' || typeof worker.port.removeEventListener !== 'function')
        throw new SocketFuseError('WORKER_CONSTRUCTION_FAILED')
      // 只有握手成功才提交 shared 选择。
      const candidate = new PortTransport(worker.port, participant.sessionId, 'shared-worker', mode, participant.budget, participant.onMessage, failure)
      transport = candidate
      /** 构造窗口和已选择 shared 的运行故障使用不同安全码。 */
      const onError = (): void => candidate.fail(new SocketFuseError(chosen === undefined ? 'WORKER_LOAD_FAILED' : 'WORKER_DISCONNECTED', { retryable: true }))
      worker.addEventListener?.('error', onError)
      candidate.addCleanup(() => worker.removeEventListener?.('error', onError))
      await candidate.handshake()
      chosen = 'shared-worker'
      participant.onSelected('shared-worker', mode)
      return candidate
    }
    catch (error) {
      transport?.destroy()
      if (chosen === undefined && mode === 'inline' && fallback === 'direct' && error instanceof SocketFuseError && fallbackCodes.has(error.code))
        return direct()
      throw error
    }
  }
}
