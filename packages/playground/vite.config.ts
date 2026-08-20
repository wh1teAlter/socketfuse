import type { UserConfig } from 'vite'
import { defineConfig } from 'vite'

const config: UserConfig = {
  server: {
    port: 4173,
  },
}

const resolvedConfig: UserConfig = defineConfig(config)

export default resolvedConfig
