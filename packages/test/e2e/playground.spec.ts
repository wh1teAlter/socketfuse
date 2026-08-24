import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

function namespace(testId: string): string {
  return `${testId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function socketUrl(value: string): string {
  return `ws://127.0.0.1:8787/socket?namespace=${value}`
}

async function stats(request: APIRequestContext, value: string): Promise<{ activeConnections: number, lastUrl: string | null, totalConnections: number, totalMessages: number }> {
  const response = await request.get(`http://127.0.0.1:8787/stats?namespace=${value}`)
  return await response.json() as { activeConnections: number, lastUrl: string | null, totalConnections: number, totalMessages: number }
}

async function closeSockets(request: APIRequestContext, value: string): Promise<void> {
  await request.post(`http://127.0.0.1:8787/control?namespace=${value}&action=close`)
}

async function broadcast(request: APIRequestContext, value: string, message: string): Promise<void> {
  await request.post(`http://127.0.0.1:8787/control?namespace=${value}&action=broadcast&message=${encodeURIComponent(message)}`)
}

async function dispatchPageTransition(page: Page, type: 'pagehide' | 'pageshow', persisted: boolean): Promise<void> {
  await page.evaluate(({ persisted, type }) => {
    const event = new Event(type)
    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }, { persisted, type })
}

async function connect(page: Page, url: string, id: string): Promise<void> {
  await page.getByLabel('URL').fill(url)
  await page.getByLabel('Connection id').fill(id)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('OPEN')
}

test('loads the public playground and exposes connection controls', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/playground')
  await expect(page.getByRole('heading', { name: 'Shared WebSocket console' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open another tab' }).click()
  await expect(page.getByRole('heading', { name: 'Shared WebSocket console' })).toHaveCount(1)
})

test('shares one physical WebSocket across two tabs', async ({ browser, request }) => {
  const testNamespace = namespace('two-tabs')
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  await Promise.all([
    first.goto('http://127.0.0.1:4173/playground'),
    second.goto('http://127.0.0.1:4173/playground'),
  ])

  for (const page of [first, second])
    await connect(page, socketUrl(testNamespace), `playwright-shared-${testNamespace}`)

  await expect.poll(async () => {
    return (await stats(request, testNamespace)).activeConnections
  }).toBe(1)

  await first.getByPlaceholder('Message payload').fill('shared-message')
  await first.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(first.locator('#messages li')).toContainText('shared-message')
  await expect(second.locator('#messages li')).toContainText('shared-message')
  await context.close()
})

test('reconnects the selected SharedWorker transport after an ordinary socket failure', async ({ page, request }) => {
  const testNamespace = namespace('reconnect')
  await page.goto('http://127.0.0.1:4173/playground')
  await connect(page, socketUrl(testNamespace), `reconnect-${testNamespace}`)
  await closeSockets(request, testNamespace)
  await expect(page.locator('#transport')).toHaveText('shared-worker')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => (await stats(request, testNamespace)).totalConnections).toBe(2)
})

test('reloads a page and releases its logical client without leaking the physical socket', async ({ page, request }) => {
  const testNamespace = namespace('reload')
  await page.goto('http://127.0.0.1:4173/playground')
  await connect(page, socketUrl(testNamespace), `reload-${testNamespace}`)
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)
  await page.reload()
  await expect(page.locator('#status')).toHaveText('CLOSED')
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections, { timeout: 10_000 }).toBe(0)
})

test('echoes typed-array, ArrayBuffer, and Blob messages over the shared connection', async ({ page, request }) => {
  const testNamespace = namespace('binary')
  await page.goto('http://127.0.0.1:4173/playground')
  await connect(page, socketUrl(testNamespace), `binary-${testNamespace}`)
  await page.getByRole('button', { name: 'Send typed array', exact: true }).click()
  await page.getByRole('button', { name: 'Send ArrayBuffer', exact: true }).click()
  await page.getByRole('button', { name: 'Send Blob', exact: true }).click()
  await expect(page.locator('#messages')).toContainText('[binary]')
  await expect(page.locator('#messages')).toContainText('1,2,3')
  await expect(page.locator('#messages')).toContainText('4,5,6')
  await expect(page.locator('#messages')).toContainText('7,8,9')
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)
})

test('suspends on BFCache pagehide, replays on pageshow, and otherwise auto-closes', async ({ page, request }) => {
  const replayNamespace = namespace('bfcache-replay')
  await page.goto('http://127.0.0.1:4173/playground')
  await page.getByLabel('Replay while hidden').check()
  await connect(page, socketUrl(replayNamespace), `bfcache-replay-${replayNamespace}`)
  await dispatchPageTransition(page, 'pagehide', true)
  await broadcast(request, replayNamespace, 'while-frozen')
  await dispatchPageTransition(page, 'pageshow', true)
  await expect(page.locator('#messages li')).toContainText('[replayed]')
  await expect(page.locator('#messages li')).toContainText('while-frozen')
  await expect(page.locator('#status')).toHaveText('OPEN')

  const autoCloseNamespace = namespace('bfcache-autoclose')
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.getByLabel('Replay while hidden').uncheck()
  await connect(page, socketUrl(autoCloseNamespace), `bfcache-autoclose-${autoCloseNamespace}`)
  await dispatchPageTransition(page, 'pagehide', true)
  await expect(page.locator('#status')).toHaveText('CLOSED')
  await expect.poll(async () => (await stats(request, autoCloseNamespace)).activeConnections, { timeout: 10_000 }).toBe(0)
})

test('rebuilds a terminated SharedWorker after BFCache restore without direct fallback', async ({ page, request }) => {
  const testNamespace = namespace('worker-restart')
  await page.goto('http://127.0.0.1:4173/playground?e2eWorkerRestart=1')
  await page.getByLabel('Replay while hidden').check()
  await connect(page, socketUrl(testNamespace), `worker-restart-${testNamespace}`)
  await dispatchPageTransition(page, 'pagehide', true)
  await page.evaluate(() => {
    const playground = window as unknown as { __wwsPlaygroundTerminateWorker: () => void }
    playground.__wwsPlaygroundTerminateWorker()
  })
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(0)
  await dispatchPageTransition(page, 'pageshow', true)
  await expect(page.locator('#transport')).toHaveText('shared-worker')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => (await stats(request, testNamespace)).totalConnections).toBe(2)
})

test('replays the latest URL and auth revisions after Worker restart', async ({ page, request }) => {
  const testNamespace = namespace('revision-replay')
  const initialUrl = socketUrl(testNamespace)
  const revisedUrl = `${initialUrl}&revision=2`
  await page.goto('http://127.0.0.1:4173/playground?e2eWorkerRestart=1&e2eRevisionReplay=1')
  await page.getByLabel('Replay while hidden').check()
  await connect(page, initialUrl, `revision-replay-${testNamespace}`)
  await page.evaluate((url) => {
    const playground = window as unknown as { __wwsPlaygroundApplyRevisions: (nextUrl: string) => Promise<void> }
    return playground.__wwsPlaygroundApplyRevisions(url)
  }, revisedUrl)
  await expect.poll(async () => (await stats(request, testNamespace)).lastUrl).toContain('revision=2')
  await expect.poll(async () => (await stats(request, testNamespace)).totalMessages).toBe(1)
  await dispatchPageTransition(page, 'pagehide', true)
  await page.evaluate(() => {
    const playground = window as unknown as { __wwsPlaygroundTerminateWorker: () => void }
    playground.__wwsPlaygroundTerminateWorker()
  })
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(0)
  await dispatchPageTransition(page, 'pageshow', true)
  await expect(page.locator('#transport')).toHaveText('shared-worker')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => (await stats(request, testNamespace)).totalConnections).toBe(3)
  await expect.poll(async () => (await stats(request, testNamespace)).lastUrl).toContain('revision=2')
  await expect.poll(async () => (await stats(request, testNamespace)).totalMessages).toBe(2)
})

test('releases the physical socket after every client disconnects', async ({ page, request }) => {
  const testNamespace = namespace('cleanup')
  await page.goto('http://127.0.0.1:4173/playground')
  await connect(page, socketUrl(testNamespace), `cleanup-${testNamespace}`)
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('CLOSED')
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections, { timeout: 10_000 }).toBe(0)
})

test('uses direct only for a Worker construction failure when fallback allows it', async ({ page, request }) => {
  const testNamespace = namespace('fallback')
  await page.goto('http://127.0.0.1:4173/playground')
  await page.getByLabel('URL').fill(socketUrl(testNamespace))
  await page.getByLabel('Connection id').fill(`fallback-direct-${testNamespace}`)
  await page.getByLabel('Simulate Worker init failure').check()
  await page.getByLabel('Fallback').selectOption('direct')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#transport')).toHaveText('direct')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => {
    return (await stats(request, testNamespace)).totalConnections
  }).toBe(1)

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.getByLabel('Connection id').fill(`fallback-error-${testNamespace}`)
  await page.getByLabel('Fallback').selectOption('error')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#error')).toContainText('WORKER_CONSTRUCTION_FAILED')
  await expect(page.locator('#transport')).toHaveText('pending')
})

test('shares one physical WebSocket across three and twenty tabs', async ({ browser, request }) => {
  test.slow()
  const testNamespace = namespace('tab-matrix')
  const context = await browser.newContext()
  const pages = await Promise.all(Array.from({ length: 3 }, () => context.newPage()))
  try {
    await Promise.all(pages.map(page => page.goto('http://127.0.0.1:4173/playground')))
    await Promise.all(pages.map(page => connect(page, socketUrl(testNamespace), `tab-matrix-${testNamespace}`)))
    await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)

    const extraPages = await Promise.all(Array.from({ length: 17 }, () => context.newPage()))
    pages.push(...extraPages)
    await Promise.all(extraPages.map(page => page.goto('http://127.0.0.1:4173/playground')))
    await Promise.all(extraPages.map(page => connect(page, socketUrl(testNamespace), `tab-matrix-${testNamespace}`)))
    await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)

    await pages[0]?.getByPlaceholder('Message payload').fill('ordered-broadcast')
    await pages[0]?.getByRole('button', { name: 'Send', exact: true }).click()
    await Promise.all(pages.map(page => expect(page.locator('#messages li')).toContainText('ordered-broadcast')))

    await pages[0]?.close()
    await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)
  }
  finally {
    await context.close()
  }
})
