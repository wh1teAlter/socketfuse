import { expect, test } from '@playwright/test'

test('loads the public playground and exposes connection controls', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173/playground')
  await expect(page.getByRole('heading', { name: 'Shared WebSocket console' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Open another tab' }).click()
  await expect(page.getByRole('heading', { name: 'Shared WebSocket console' })).toHaveCount(1)
})

test('shares one physical WebSocket across two tabs', async ({ browser, request }) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  const second = await context.newPage()
  await Promise.all([
    first.goto('http://127.0.0.1:4173/playground'),
    second.goto('http://127.0.0.1:4173/playground'),
  ])

  for (const page of [first, second]) {
    page.on('console', (message) => {
      if (message.type() === 'error')
        process.stderr.write(`[page:${message.type()}] ${message.text()}\n`)
    })
    page.on('pageerror', error => process.stderr.write(`[pageerror] ${error.message}\n`))
    await page.getByLabel('URL').fill('ws://127.0.0.1:8787/socket')
    await page.getByLabel('Connection id').fill('playwright-shared')
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect(page.locator('#status')).toHaveText('OPEN')
  }

  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:8787/stats')
    return (await response.json()).activeConnections
  }).toBe(1)

  await first.getByPlaceholder('Message payload').fill('shared-message')
  await first.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(first.locator('#messages li')).toContainText('shared-message')
  await expect(second.locator('#messages li')).toContainText('shared-message')
  await context.close()
})

test('uses direct only for a Worker construction failure when fallback allows it', async ({ page, request }) => {
  await page.goto('http://127.0.0.1:4173/playground')
  await page.getByLabel('URL').fill('ws://127.0.0.1:8787/socket')
  await page.getByLabel('Connection id').fill('fallback-direct')
  await page.getByLabel('Simulate Worker init failure').check()
  await page.getByLabel('Fallback').selectOption('direct')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#transport')).toHaveText('direct')
  await expect(page.locator('#status')).toHaveText('OPEN')
  await expect.poll(async () => {
    const response = await request.get('http://127.0.0.1:8787/stats')
    return (await response.json()).totalConnections
  }).toBeGreaterThan(1)

  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await page.getByLabel('Connection id').fill('fallback-error')
  await page.getByLabel('Fallback').selectOption('error')
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
  await expect(page.locator('#error')).toContainText('WORKER_CONSTRUCTION_FAILED')
  await expect(page.locator('#transport')).toHaveText('pending')
})
