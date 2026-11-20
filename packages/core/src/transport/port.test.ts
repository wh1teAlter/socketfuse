/** 验证页面端口在已发出 suspend 后退回投递，而不是在页面侧丢弃。 */
import { describe, expect, it } from 'vitest'
import type { MessagePortLike, WorkerControlMessage } from '../runtime/control'
import { OperationBudget, PortTransport } from './port'

/** 记录页面发往 runtime 的消息，并可向页面派发控制消息的端口替身。 */
function fakePort() {
  const posted: { readonly type: string, readonly deliveryId?: number }[] = []
  // 页面端口安装的唯一 message 监听。
  let listener: ((event: { readonly data: unknown }) => void) | undefined
  const port: MessagePortLike = {
    postMessage: message => posted.push(message as typeof posted[number]),
    addEventListener: (type, callback) => {
      if (type === 'message')
        listener = callback
    },
    removeEventListener: () => undefined,
  }
  return { port, posted, emit: (data: unknown) => listener?.({ data }) }
}

/** 构造一条属于 session 的业务投递。 */
function frame(deliveryId: number): WorkerControlMessage {
  return { type: 'message', sessionId: 'session', connectionEpoch: 'epoch', data: deliveryId, deliveryId, receivedAt: deliveryId, replayed: false, dispatch: [] }
}

describe('port transport delivery receipts', () => {
  it('requeues deliveries that arrive after suspend and receipts them again after restore', () => {
    const { port, posted, emit } = fakePort()
    const received: WorkerControlMessage[] = []
    const transport = new PortTransport(port, 'session', 'direct', 'none', new OperationBudget(), message => received.push(message), () => undefined)
    transport.notify({ type: 'suspend' })
    emit(frame(1))
    transport.notify({ type: 'restore' })
    emit(frame(2))
    expect(posted.filter(message => message.deliveryId !== undefined)).toEqual([
      { type: 'requeue', deliveryId: 1, sessionId: 'session' },
      { type: 'receipt', deliveryId: 2, sessionId: 'session' },
    ])
    expect(received.map(message => message.type === 'message' && message.deliveryId)).toEqual([2])
    transport.destroy()
  })
})
