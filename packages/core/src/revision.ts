import type { RevisionReceipt } from './types'
import { WwsError } from './errors'

export function assertRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision <= 0)
    throw new WwsError('INVALID_OPTIONS', 'revision must be a positive safe integer', { details: { field: 'revision' } })
}

export class RevisionRegister<Value> {
  private currentRevision: number
  private currentValue: Value

  constructor(initialValue: Value, initialRevision = 0) {
    if (!Number.isSafeInteger(initialRevision) || initialRevision < 0)
      throw new WwsError('INVALID_OPTIONS', 'initial revision must be a non-negative safe integer')
    this.currentRevision = initialRevision
    this.currentValue = initialValue
  }

  get revision(): number {
    return this.currentRevision
  }

  get value(): Value {
    return this.currentValue
  }

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
