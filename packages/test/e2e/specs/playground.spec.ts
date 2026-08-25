/**
 * Playground 的跨浏览器行为验收。
 *
 * 辅助函数只封装测试服务请求与页面控制，不改变产品 API；每个测试使用独立
 * namespace，避免并行运行时共享统计状态。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'

/** 为单个测试生成隔离的服务 namespace。 */
function namespace(testId: string): string {
  return `${testId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** 生成本地 E2E WebSocket 地址。 */
function socketUrl(value: string): string {
  return `ws://127.0.0.1:8787/socket?namespace=${value}`
}

/** 读取测试服务的连接统计。 */
async function stats(request: APIRequestContext, value: string): Promise<{ activeConnections: number, lastUrl: string | null, totalConnections: number, totalMessages: number }> {
  const response = await request.get(`http://127.0.0.1:8787/stats?namespace=${value}`)
  return await response.json() as { activeConnections: number, lastUrl: string | null, totalConnections: number, totalMessages: number }
}

/** 请求测试服务关闭指定 namespace 的物理 sockets。 */
async function closeSockets(request: APIRequestContext, value: string): Promise<void> {
  await request.post(`http://127.0.0.1:8787/control?namespace=${value}&action=close`)
}

/** 通过测试服务向 namespace 内所有 socket 广播消息。 */
async function broadcast(request: APIRequestContext, value: string, message: string): Promise<void> {
  await request.post(`http://127.0.0.1:8787/control?namespace=${value}&action=broadcast&message=${encodeURIComponent(message)}`)
}

/** 在页面 realm 派发生命周期事件，验证冻结与恢复开关。 */
async function dispatchPageTransition(page: Page, type: 'pagehide' | 'pageshow', persisted: boolean): Promise<void> {
  await page.evaluate(({ persisted, type }) => {
    const event = new Event(type)
    Object.defineProperty(event, 'persisted', { value: persisted })
    window.dispatchEvent(event)
  }, { persisted, type })
}

/** 填充 playground 表单并等待 client 打开。 */
async function connect(page: Page, url: string, id: string): Promise<void> {
  await page.getByLabel('URL').fill(url)
  await page.getByLabel('连接 id').fill(id)
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('OPEN')
}

test('loads the public playground and exposes connection controls', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/playground')
  await expect(page.getByRole('heading', { name: '共享 WebSocket 控制台' })).toBeVisible()
  await expect(page.getByRole('button', { name: '连接', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '打开另一个标签页' }).click()
  await expect(page.getByRole('heading', { name: '共享 WebSocket 控制台' })).toHaveCount(1)
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

  await first.getByPlaceholder('消息内容').fill('shared-message')
  await first.getByRole('button', { name: '发送', exact: true }).click()
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
  await page.getByRole('button', { name: '发送类型化数组', exact: true }).click()
  await page.getByRole('button', { name: '发送 ArrayBuffer', exact: true }).click()
  await page.getByRole('button', { name: '发送 Blob', exact: true }).click()
  await expect(page.locator('#messages')).toContainText('[二进制]')
  await expect(page.locator('#messages')).toContainText('1,2,3')
  await expect(page.locator('#messages')).toContainText('4,5,6')
  await expect(page.locator('#messages')).toContainText('7,8,9')
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)
})

test('suspends on BFCache pagehide, replays on pageshow, and otherwise auto-closes', async ({ page, request }) => {
  const replayNamespace = namespace('bfcache-replay')
  await page.goto('http://127.0.0.1:4173/playground')
  await page.getByLabel('页面隐藏时回放').check()
  await connect(page, socketUrl(replayNamespace), `bfcache-replay-${replayNamespace}`)
  await dispatchPageTransition(page, 'pagehide', true)
  await broadcast(request, replayNamespace, 'while-frozen')
  await dispatchPageTransition(page, 'pageshow', true)
  await expect(page.locator('#messages li')).toContainText('[已回放]')
  await expect(page.locator('#messages li')).toContainText('while-frozen')
  await expect(page.locator('#status')).toHaveText('OPEN')

  const autoCloseNamespace = namespace('bfcache-autoclose')
  await page.getByRole('button', { name: '断开连接', exact: true }).click()
  await page.getByLabel('页面隐藏时回放').uncheck()
  await connect(page, socketUrl(autoCloseNamespace), `bfcache-autoclose-${autoCloseNamespace}`)
  await dispatchPageTransition(page, 'pagehide', true)
  await expect(page.locator('#status')).toHaveText('CLOSED')
  await expect.poll(async () => (await stats(request, autoCloseNamespace)).activeConnections, { timeout: 10_000 }).toBe(0)
})

test('rebuilds a terminated SharedWorker after BFCache restore without direct fallback', async ({ page, request }) => {
  const testNamespace = namespace('worker-restart')
  await page.goto('http://127.0.0.1:4173/playground?e2eWorkerRestart=1')
  await page.getByLabel('页面隐藏时回放').check()
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
  await page.getByLabel('页面隐藏时回放').check()
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
  await page.getByRole('button', { name: '断开连接', exact: true }).click()
  await expect(page.locator('#status')).toHaveText('CLOSED')
  await expect.poll(async () => (await stats(request, testNamespace)).activeConnections, { timeout: 10_000 }).toBe(0)
})

test('uses direct only for a Worker construction failure when fallback allows it', async ({ page, request }) => {
  const testNamespace = namespace('fallback')
  await page.goto('http://127.0.0.1:4173/playground')
  await page.getByLabel('URL').fill(socketUrl(testNamespace))
  await page.getByLabel('连接 id').fill(`fallback-direct-${testNamespace}`)
  await page.getByLabel('模拟 Worker 初始化失败').check()
  await page.getByLabel('降级策略').selectOption('direct')
  await page.getByRole('button', { name: '连接', exact: true }).click()
  await expect(page.locator('#transport')).toHaveText('direct')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => {
    return (await stats(request, testNamespace)).totalConnections
  }).toBe(1)

  await page.getByRole('button', { name: '断开连接', exact: true }).click()
  await page.getByLabel('连接 id').fill(`fallback-error-${testNamespace}`)
  await page.getByLabel('降级策略').selectOption('error')
  await page.getByRole('button', { name: '连接', exact: true }).click()
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

    await pages[0]?.getByPlaceholder('消息内容').fill('ordered-broadcast')
    await pages[0]?.getByRole('button', { name: '发送', exact: true }).click()
    await Promise.all(pages.map(page => expect(page.locator('#messages li')).toContainText('ordered-broadcast')))

    await pages[0]?.close()
    await expect.poll(async () => (await stats(request, testNamespace)).activeConnections).toBe(1)
  }
  finally {
    await context.close()
  }
})
