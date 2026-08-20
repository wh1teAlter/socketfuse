import type { UserConfig } from 'vitepress'
import { defineConfig } from 'vitepress'

const config: UserConfig = {
  description: 'SharedWorker-first WebSocket connection sharing.',
  title: 'wws',
}

const resolvedConfig: UserConfig = defineConfig(config)

export default resolvedConfig
