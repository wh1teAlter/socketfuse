/** 验证 execution key 的非抢占选主、可见性偏好与冻结交接。 */
import { describe, expect, it } from 'vitest'
import { ExclusiveKeyRegistry } from './exclusive-keys'

describe('exclusive key registry', () => {
  it('keeps the first holder and selects visible FIFO candidates on transfer', () => {
    const events: string[] = []
    const registry = new ExclusiveKeyRegistry({
      onGrant: (client, key) => events.push(`grant:${client}:${key}`),
      onRevoke: (client, key) => events.push(`revoke:${client}:${key}`),
    })

    registry.register('hidden-first', 'write', 'hidden')
    registry.register('visible-first', 'write', 'visible')
    registry.register('visible-second', 'write', 'visible')
    expect(registry.keysForClient('visible-second')).toEqual(['write'])
    expect(events).toEqual(['grant:hidden-first:write'])

    registry.setVisibility('hidden-first', 'frozen')
    expect(events).toEqual([
      'grant:hidden-first:write',
      'revoke:hidden-first:write',
      'grant:visible-first:write',
    ])
    registry.unregister('visible-first', 'write')
    expect(events.at(-2)).toBe('revoke:visible-first:write')
    expect(events.at(-1)).toBe('grant:visible-second:write')
  })
})
