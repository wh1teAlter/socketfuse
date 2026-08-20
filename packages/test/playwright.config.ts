import type { PlaywrightTestConfig } from '@playwright/test'
import { defineConfig, devices } from '@playwright/test'

const config: PlaywrightTestConfig = {
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  testDir: './e2e',
  webServer: [
    {
      command: 'pnpm --filter @wws/playground dev --host 127.0.0.1',
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

const resolvedConfig: PlaywrightTestConfig = defineConfig(config)

export default resolvedConfig
