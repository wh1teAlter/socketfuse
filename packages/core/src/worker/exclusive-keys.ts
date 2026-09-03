/**
 * 为一条共享连接仲裁 execution key；只管理候选与授权，不接触业务消息或页面函数。
 */
import type { ClientVisibility } from '../shared/types'

/** execution key 授权变化的 Worker 回调。 */
export interface ExclusiveKeyRegistryCallbacks {
  /** 新 holder 确认后发送 grant。 */
  readonly onGrant: (clientId: string, key: string) => void
  /** 旧 holder 清除后发送 revoke。 */
  readonly onRevoke: (clientId: string, key: string) => void
}

/** 单个页面对 execution key 的候选记录。 */
interface Candidate {
  /** 页面逻辑 client id。 */
  readonly clientId: string
  /** 注册时的全局 FIFO 序号。 */
  readonly order: number
  /** Worker 最近收到的页面活性。 */
  visibility: ClientVisibility
}

/** 一个 execution key 的全部候选和当前 holder。 */
interface KeyEntry {
  /** client id 到候选状态。 */
  readonly candidates: Map<string, Candidate>
  /** 当前唯一 holder；空值表示暂时无人可执行。 */
  holder: string | undefined
}

/** 按非抢占、可见性优先和 FIFO 规则维护一条连接的 execution keys。 */
export class ExclusiveKeyRegistry {
  /** key 到候选集合与 holder。 */
  private readonly entries = new Map<string, KeyEntry>()
  /** 注册顺序的单调序号。 */
  private sequence = 0

  /** 创建仅通过回调发布授权变化的 registry。 */
  constructor(private readonly callbacks: ExclusiveKeyRegistryCallbacks) {}

  /** 返回当前不同 key 数。 */
  get size(): number {
    return this.entries.size
  }

  /** 判断 key 是否已经计入本连接。 */
  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** 返回指定页面当前注册的 keys，供 freeze 控制帧建立撤销屏障。 */
  keysForClient(clientId: string): readonly string[] {
    return [...this.entries.entries()]
      .filter(([, entry]) => entry.candidates.has(clientId))
      .map(([key]) => key)
  }

  /** 注册候选；返回是否新建了不同 key。 */
  register(clientId: string, key: string, visibility: ClientVisibility): boolean {
    let entry = this.entries.get(key)
    const created = entry === undefined
    if (entry === undefined) {
      entry = { candidates: new Map(), holder: undefined }
      this.entries.set(key, entry)
    }
    if (entry.candidates.has(clientId))
      return created
    entry.candidates.set(clientId, { clientId, order: ++this.sequence, visibility })
    if (entry.holder === undefined)
      this.select(key, entry)
    return created
  }

  /** 注销候选；返回该 key 是否已无候选并被删除。 */
  unregister(clientId: string, key: string): boolean {
    const entry = this.entries.get(key)
    if (entry === undefined || !entry.candidates.delete(clientId))
      return false
    if (entry.holder === clientId) {
      entry.holder = undefined
      this.callbacks.onRevoke(clientId, key)
      this.select(key, entry)
    }
    if (entry.candidates.size > 0)
      return false
    this.entries.delete(key)
    return true
  }

  /** 更新候选可见性；hidden 不抢占，frozen holder 会立即交接。 */
  setVisibility(clientId: string, visibility: ClientVisibility): void {
    for (const [key, entry] of this.entries) {
      const candidate = entry.candidates.get(clientId)
      if (candidate === undefined)
        continue
      candidate.visibility = visibility
      if (visibility === 'frozen' && entry.holder === clientId) {
        entry.holder = undefined
        this.callbacks.onRevoke(clientId, key)
        this.select(key, entry)
      }
      else if (entry.holder === undefined) {
        this.select(key, entry)
      }
    }
  }

  /** 移除页面全部候选；返回被完整删除的不同 key 数。 */
  removeClient(clientId: string): number {
    let removedKeys = 0
    for (const key of [...this.entries.keys()]) {
      if (this.unregister(clientId, key))
        removedKeys++
    }
    return removedKeys
  }

  /** 按 visible 优先、组内 FIFO 选出下一 holder。 */
  private select(key: string, entry: KeyEntry): void {
    const candidates = [...entry.candidates.values()]
      .filter(candidate => candidate.visibility !== 'frozen')
      .sort((left, right) => {
        const leftRank = left.visibility === 'visible' ? 0 : 1
        const rightRank = right.visibility === 'visible' ? 0 : 1
        return leftRank - rightRank || left.order - right.order
      })
    const selected = candidates[0]
    if (selected === undefined)
      return
    entry.holder = selected.clientId
    this.callbacks.onGrant(selected.clientId, key)
  }
}
