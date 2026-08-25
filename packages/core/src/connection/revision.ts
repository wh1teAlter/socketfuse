/** 维护 endpoint 与 auth 的单调 revision，防止旧页面状态覆盖新值。 */
import type { RevisionReceipt } from '../shared/types'
import { WwsError } from '../shared/errors'

/** 校验 revision 为正安全整数，避免跨页面更新顺序歧义。 */
export function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision <= 0)
    throw new WwsError('INVALID_OPTIONS', 'revision must be a positive safe integer', { details: { field: 'revision' } })
}

export class RevisionRegister<Value> {
  /** 当前 revision；只允许单调不下降。 */
  private currentRevision: number
  /** 当前 revision 对应的业务值。 */
  private currentValue: Value

  /** 创建带初始 revision/value 的寄存器。 */
  constructor(initialValue: Value, initialRevision = 0) {
    if (!Number.isSafeInteger(initialRevision) || initialRevision < 0)
      throw new WwsError('INVALID_OPTIONS', 'initial revision must be a non-negative safe integer')
    this.currentRevision = initialRevision
    this.currentValue = initialValue
  }

  /** 暴露当前 revision。 */
  get revision(): number {
    return this.currentRevision
  }

  /** 暴露当前业务值。 */
  get value(): Value {
    return this.currentValue
  }

  /** 应用单调更新；旧值返回 stale 且不改变状态。 */
  update(value: Value, revision: number): RevisionReceipt {
    assertRevision(revision)
    if (revision < this.currentRevision)
      return { revision: this.currentRevision, status: 'stale' }
    if (revision === this.currentRevision)
      return { revision, status: 'unchanged' }
    this.currentRevision = revision
    this.currentValue = value
    return { revision, status: 'applied' }
  }
}

export class EndpointRevisionRegister extends RevisionRegister<string> {
  /** 创建以初始 ws/wss endpoint 为 revision 0 的寄存器。 */
  override update(value: string, revision: number): RevisionReceipt {
    assertRevision(revision)
    if (revision < this.revision)
      return { revision: this.revision, status: 'stale' }
    if (revision === this.revision) {
      if (value !== this.value)
        throw new WwsError('CONNECTION_CONFIG_CONFLICT', 'Endpoint revision conflicts with the current URL')
      return { revision, status: 'unchanged' }
    }
    return super.update(value, revision)
  }
}

export class AuthRevisionRegister<Value> extends RevisionRegister<Value | undefined> {
  /** 创建无认证值或给定初始认证值的寄存器。 */
  constructor(initialValue?: Value, initialRevision = 0) {
    super(initialValue, initialRevision)
  }

  override update(value: Value | undefined, revision: number): RevisionReceipt {
    assertRevision(revision)
    if (revision <= this.revision)
      return { revision: this.revision, status: 'stale' }
    return super.update(value, revision)
  }
}
