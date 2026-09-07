/** 验证准备事务的 setter 期限、同步取消授权和真实未结算容量。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BeforeReconnectContext } from './types'
import { beginPreparation } from './preparation'

/** 测试计划只含安全描述。 */
const plan = { attempt: 2, defaultDelay: 10, source: 'page' as const, countAsRetry: true, retriesUsed: 0, close: { code: 1006, terminal: false, wasClean: false }, reason: 'socket-close' as const, deadline: 100 }
afterEach(() => vi.useRealTimers())

describe('bounded preparation', () => {
  it('aborts immediately inside a synchronous hook and disallows further setters', async () => {
    let cancel = (): void => undefined
    let aborted = false
    const complete = vi.fn()
    beginPreparation({}, plan, (context) => {
      cancel()
      aborted = context.signal.aborted
      expect(() => context.setDelay(0)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
    }, { now: () => 0, onStart: (value) => {
      cancel = value
    }, onComplete: complete })
    await Promise.resolve()
    expect(aborted).toBe(true)
    expect(complete).not.toHaveBeenCalled()
  })
  it('checks the absolute deadline even before the timer has run', async () => {
    let now = 0
    let context: BeforeReconnectContext | undefined
    let settle!: () => void
    const complete = vi.fn()
    const cancel = beginPreparation({}, plan, (value) => {
      context = value
      return new Promise((resolve) => {
        settle = resolve
      })
    }, { now: () => now, onComplete: complete })
    now = 100
    expect(() => context!.setDelay(0)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
    settle()
    await Promise.resolve()
    expect(complete).toHaveBeenCalledWith(undefined)
    cancel()
  })
  it('does not reclaim busy capacity on cancellation until the actual promise settles', async () => {
    const source = {}
    let settle!: () => void
    const cancel = beginPreparation(source, plan, () => new Promise((resolve) => {
      settle = resolve
    }), { now: () => 0, onComplete: () => {} })
    cancel()
    expect(() => beginPreparation(source, plan, () => {}, { now: () => 0, onComplete: () => {} })).toThrowError(expect.objectContaining({ code: 'PREPARATION_BUSY' }))
    settle()
    await Promise.resolve()
    const next = beginPreparation(source, plan, () => {}, { now: () => 0, onComplete: () => {} })
    next()
    await Promise.resolve()
  })
  it('does not partially commit URL when validation throws and disposes setters on success', async () => {
    let context: BeforeReconnectContext | undefined
    const complete = vi.fn()
    beginPreparation({}, plan, (value) => {
      context = value
      expect(() => value.setOptions({ url: 'wss://user:secret@example.test' })).toThrowError()
      value.setDelay(3)
    }, { now: () => 0, onComplete: complete })
    await Promise.resolve()
    expect(complete).toHaveBeenCalledWith({ delay: 3 })
    expect(context!.signal.aborted).toBe(true)
    expect(() => context!.setDelay(9)).toThrowError(expect.objectContaining({ code: 'STALE_RECONNECT_PLAN' }))
  })
})
