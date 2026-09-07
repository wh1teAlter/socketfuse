/** 隔离应用回调与同步协议契约，避免用户异常或未处理 rejection 改变连接推进。 */
import { SocketFuseError, type SocketFuseErrorCode } from './errors'

/** 安全调用失败通知；通知自身的失败不递归报告。 */
function reportFailure(callback?: () => void): void {
  try {
    callback?.()
  }
  catch {
    // 观察失败不能改变已提交的内部状态。
  }
}

/**
 * 调用不影响状态推进的外部观察者，同时消费意外异步失败。
 * @param callback 页面 handler、logger 或生命周期观察者。
 * @param onFailure 可选的安全失败通知；不会再次递归调用。
 */
export function observeCallback(callback: () => unknown, onFailure?: () => void): void {
  try {
    const result = callback()
    if (result !== null && (typeof result === 'object' || typeof result === 'function'))
      void Promise.resolve(result).catch(() => reportFailure(onFailure))
  }
  catch {
    reportFailure(onFailure)
  }
}

/**
 * 在协议同步边界调用应用函数；外部错误按阶段重映射，thenable 为终止性违约。
 * @param callback 当前尝试的协议转换或同步 hook。
 * @param code 普通 throw 的安全阶段错误码。
 * @returns 同步返回值；调用方仍须验证其类型与当前尝试。
 * @throws 阶段错误，或 fatal 的 PROTOCOL_CONTRACT_VIOLATION。
 */
export function invokeSynchronous<Value>(callback: () => Value, code: SocketFuseErrorCode): Value {
  let result: Value
  let asynchronous = false
  try {
    result = callback()
    asynchronous = result !== null && (typeof result === 'object' || typeof result === 'function')
      && typeof (result as { then?: unknown }).then === 'function'
  }
  catch {
    throw new SocketFuseError(code)
  }
  if (asynchronous) {
    // 只能消费 rejection，不能强行取消应用异步工作；不挂入任何协议队尾。
    void Promise.resolve(result).catch(() => undefined)
    throw new SocketFuseError('PROTOCOL_CONTRACT_VIOLATION', { fatal: true })
  }
  return result
}
