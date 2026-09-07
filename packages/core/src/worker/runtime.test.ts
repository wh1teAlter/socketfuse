/** 两种接入通过真实端口运行同一 client 契约，覆盖连接所有权、预算与参与期重建。 */
import { afterEach, describe, expect, it } from 'vitest'
import { harness, until } from '../../test/fixtures'

/** 测试拥有的运行时，afterEach 串行释放。 */
const scopes: ReturnType<typeof harness>[] = []
afterEach(async () => {
  for (const scope of scopes.splice(0)) await scope.dispose()
})

for (const kind of ['shared-worker', 'direct'] as const) {
  describe(kind + ' runtime contract', () => {
    it('shares one socket and broadcasts independently through cloned values', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const a = scope.client()
      const b = scope.client()
      const left: unknown[] = []
      const right: unknown[] = []
      a.onMessage((event) => {
        left.push(event.data)
      })
      b.onMessage((event) => {
        right.push(event.data)
      })
      const openings = [a.open(), b.open()]
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await Promise.all(openings)
      await expect(a.sendMessage('outgoing')).resolves.toMatchObject({ status: 'accepted' })
      scope.sockets[0]?.message('incoming')
      await until(() => right.length === 1)
      expect(left).toEqual(['incoming'])
      expect(right).toEqual(['incoming'])
      expect(scope.sockets).toHaveLength(1)
      expect(scope.sockets[0]?.sent).toEqual(['outgoing'])
    })

    it('rejects conflicting shared configuration without replacing the healthy socket', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const a = scope.client()
      const opening = a.open()
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await opening
      const b = scope.client({ connectionTimeout: 999 })
      const error = await b.open().catch(error => error)
      expect(error.code).toBe('CONNECTION_CONFIG_CONFLICT')
      expect(scope.sockets).toHaveLength(1)
      await expect(a.sendMessage('still-open')).resolves.toMatchObject({ status: 'accepted' })
    })

    it('constructs no port until open and creates a fresh participation after close', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client()
      expect(scope.transports).toHaveLength(0)
      const opening = client.open()
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await opening
      const first = scope.transports[0]?.sessionId
      await client.close()
      await until(() => scope.sockets[0]?.readyState === 3)
      const reopened = client.open()
      await until(() => scope.sockets.length === 2)
      scope.sockets[1]?.open()
      await reopened
      expect(scope.transports[1]?.sessionId).not.toBe(first)
      expect(client.transport).toBe(kind)
    })

    it('returns a new creator endpoint only after the idle entry has been reclaimed', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const a = scope.client({ idleGraceMs: 20 }, 'wss://example.test/first')
      const opening = a.open()
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await opening
      const b = scope.client({ idleGraceMs: 20 }, 'wss://other.test/ignored')
      await b.open()
      expect(scope.urls).toEqual(['wss://example.test/first'])
      await a.close()
      await b.close()
      await until(() => scope.sockets[0]?.readyState === 3)
      const reopened = b.open()
      await until(() => scope.sockets.length === 2)
      scope.sockets[1]?.open()
      await reopened
      expect(scope.urls[1]).toBe('wss://other.test/ignored')
    })

    it('cancels one open waiter without canceling another or the shared demand', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client()
      const abort = new AbortController()
      const canceled = client.open({ signal: abort.signal }).catch(error => error)
      const opening = client.open()
      await until(() => scope.sockets.length === 1)
      abort.abort()
      expect((await canceled).code).toBe('ABORTED')
      scope.sockets[0]?.open()
      await opening
      expect(client.state).toBe('open')
    })

    it('does not reserve an id for an already-aborted open', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client()
      const signal = AbortSignal.abort()
      await expect(client.open({ signal })).rejects.toMatchObject({ code: 'ABORTED' })
      expect(scope.transports).toHaveLength(0)
    })

    it('bounds pre-attach sends and open waiters together and does not implicitly open on send', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client({ queue: true })
      await expect(client.sendMessage('not-open')).rejects.toMatchObject({ code: 'CLIENT_DISCONNECTED' })
      const opening = client.open()
      const sends = Array.from({ length: 63 }, (_, index) => client.sendMessage(String(index)))
      await expect(client.sendMessage('too-many')).rejects.toMatchObject({ code: 'RESOURCE_LIMIT_EXCEEDED' })
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await opening
      await Promise.all(sends)
      expect(scope.sockets[0]?.sent).toEqual(Array.from({ length: 63 }, (_, index) => String(index)))
    })

    it('shares retry counts, reserves before close, joins duplicate plans and rejects policy conflicts', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const settings = { reconnect: { maxRetries: 1, initialDelay: 30, jitter: 0, stableThreshold: false as const } }
      const a = scope.client(settings)
      const b = scope.client(settings)
      const openings = [a.open(), b.open()]
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await Promise.all(openings)
      await Promise.all([a.reconnect(), b.reconnect()])
      await expect(a.reconnect({ countAsRetry: false })).rejects.toMatchObject({ code: 'RECONNECT_IN_PROGRESS' })
      await until(() => scope.sockets.length === 2)
      scope.sockets[1]?.open()
      await until(() => a.state === 'open' && b.state === 'open')
      await expect(a.reconnect()).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' })
      expect(scope.sockets[1]?.readyState).toBe(1)
      await a.reconnect({ countAsRetry: false })
      await until(() => scope.sockets.length === 3)
      scope.sockets[2]?.open()
      await until(() => a.state === 'open')
      a.diagnostics()
      await until(() => a.diagnostics().retriesUsed === 1)
      expect(a.diagnostics().attempt).toBe(3)
      expect(a.diagnostics().retriesRemaining).toBe(0)
    })

    it('does not bypass an exhausted epoch budget by close and reopen inside idle grace', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client({ idleGraceMs: 500, reconnect: { automatic: false, maxRetries: 0, stableThreshold: false } })
      const opening = client.open()
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await opening
      scope.sockets[0]?.closed(1000)
      await until(() => client.state === 'closed')
      await client.close()
      await expect(client.open()).rejects.toMatchObject({ code: 'RETRY_EXHAUSTED' })
      expect(scope.sockets).toHaveLength(1)
      await client.reconnect({ countAsRetry: false })
      await until(() => scope.sockets.length === 2)
      scope.sockets[1]?.open()
      await until(() => client.state === 'open')
    })

    it('never starts a second socket while the previous native close is incomplete', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client({ reconnect: { initialDelay: 0, jitter: 0 } })
      const opening = client.open()
      await until(() => scope.sockets.length === 1)
      const first = scope.sockets[0]!
      first.open()
      await opening
      first.deferClose = true
      await client.reconnect()
      await new Promise(resolve => setTimeout(resolve, 30))
      expect(scope.sockets).toHaveLength(1)
      expect(first.readyState).toBe(2)
      first.closed()
      await until(() => scope.sockets.length === 2)
      scope.sockets[1]?.open()
      await until(() => client.state === 'open')
    })

    it('uses a single FIFO drain and wakes when backpressure clears without a reconnect', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client({ queue: true, backpressure: { highWaterMarkBytes: 10, lowWaterMarkBytes: 2 } })
      const opening = client.open()
      await until(() => scope.sockets.length === 1)
      const socket = scope.sockets[0]!
      socket.open()
      await opening
      socket.bufferedAmount = 10
      await expect(client.sendMessage('first')).resolves.toMatchObject({ status: 'queued' })
      await expect(client.sendMessage('second')).resolves.toMatchObject({ status: 'queued' })
      socket.bufferedAmount = 0
      await client.sendMessage('third')
      await until(() => socket.sent.length === 3)
      expect(socket.sent).toEqual(['first', 'second', 'third'])
      expect(scope.sockets).toHaveLength(1)
    })

    it('selects one dispatch owner per frame, transfers on leave and excludes keyed replay', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const a = scope.client()
      const b = scope.client()
      const left: unknown[] = []
      const right: unknown[] = []
      const ordinary: unknown[] = []
      a.onMessage((event) => {
        left.push(event.data)
      }, { dispatchKey: 'effect' })
      b.onMessage((event) => {
        right.push(event.data)
      }, { dispatchKey: 'effect' })
      b.onMessage((event) => {
        ordinary.push(event.data)
      })
      const openings = [a.open(), b.open()]
      await until(() => scope.sockets.length === 1)
      scope.sockets[0]?.open()
      await Promise.all(openings)
      await until(() => a.isDispatchOwner('effect') || b.isDispatchOwner('effect'))
      scope.sockets[0]?.message('one')
      await until(() => ordinary.length === 1 && left.length + right.length === 1)
      expect(left.length + right.length).toBe(1)
      const owner = a.isDispatchOwner('effect') ? a : b
      const next = owner === a ? b : a
      await owner.close()
      await until(() => next.isDispatchOwner('effect'))
      scope.sockets[0]?.message('two')
      await until(() => left.length + right.length === 2)
      expect(scope.sockets).toHaveLength(1)
    })

    it('keeps Promise APIs on rejection after dispose and makes close/dispose idempotent', async () => {
      const scope = harness(kind)
      scopes.push(scope)
      const client = scope.client()
      await client.dispose()
      await expect(client.open()).rejects.toMatchObject({ code: 'CLIENT_DISPOSED' })
      await expect(client.sendMessage('x')).rejects.toMatchObject({ code: 'CLIENT_DISPOSED' })
      await expect(client.reconnect()).rejects.toMatchObject({ code: 'CLIENT_DISPOSED' })
      await expect(client.close()).resolves.toBeUndefined()
      await expect(client.dispose()).resolves.toBeUndefined()
    })
  })
}
