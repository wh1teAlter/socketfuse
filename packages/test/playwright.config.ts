/**
 * WWS 跨浏览器 E2E 配置。
 *
 * 每个项目使用同一 docs playground 与本地 ws 测试服务，覆盖 SharedWorker、页面
 * 生命周期和 direct fallback 的浏览器差异。
 */
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

/** 三个浏览器项目共用的测试服务器和测试目录配置。 */
const config: PlaywrightTestConfig = {
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  testDir: './e2e/specs',
  webServer: [
    {
      command: 'pnpm --filter @wws/docs dev',
      port: 4173,
      reuseExistingServer: true,
    },
    {
      command: 'node server/ws-server.mjs',
      port: 8787,
      reuseExistingServer: true,
    },
  ],
}

/** 经过 Playwright 类型辅助函数解析的最终配置。 */
const resolvedConfig: PlaywrightTestConfig = defineConfig(config)

export default resolvedConfig
