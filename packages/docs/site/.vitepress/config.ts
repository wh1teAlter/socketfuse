import { type DefaultTheme, defineConfig } from 'vitepress'

const themeConfig: DefaultTheme.Config = {
  footer: {
    copyright: 'Copyright © 2026 wws contributors',
    message: 'Released under the MIT License.',
  },
  nav: [
    { activeMatch: '^/guide/', link: '/guide/', text: 'Guide' },
    { activeMatch: '^/api/', link: '/api/', text: 'API' },
    { activeMatch: '^/protocols/', link: '/protocols/', text: 'Protocols' },
    { activeMatch: '^/reference/', link: '/reference/configuration', text: 'Reference' },
    { link: '/playground', text: 'Playground' },
  ],
  outline: { level: [2, 3], label: 'On this page' },
  search: { provider: 'local' },
  sidebar: {
    '/api/': [
      {
        items: [
          { link: '/api/', text: 'Overview' },
          { link: '/api/generated/index/README.md', text: 'wws entry' },
          { link: '/api/generated/protocol/README.md', text: 'wws/protocol' },
          { link: '/api/generated/worker/README.md', text: 'wws/worker' },
        ],
        text: 'API Reference',
      },
    ],
    '/guide/': [
      {
        items: [
          { link: '/guide/', text: 'Introduction' },
          { link: '/guide/getting-started', text: 'Getting started' },
          { link: '/guide/connection-sharing', text: 'Connection sharing' },
          { link: '/guide/reliability', text: 'Reliability' },
          { link: '/guide/lifecycle-and-replay', text: 'Lifecycle and replay' },
          { link: '/guide/fallback-and-worker', text: 'Fallback and Worker' },
        ],
        text: 'Guide',
      },
    ],
    '/protocols/': [
      {
        items: [
          { link: '/protocols/', text: 'Overview' },
          { link: '/protocols/raw', text: 'Raw protocol' },
          { link: '/protocols/json', text: 'JSON protocol' },
          { link: '/protocols/custom-adapter', text: 'Custom adapter' },
        ],
        text: 'Protocols',
      },
    ],
    '/reference/': [
      {
        items: [
          { link: '/reference/configuration', text: 'Configuration' },
          { link: '/reference/events-and-client', text: 'Events and client' },
          { link: '/reference/diagnostics-and-errors', text: 'Diagnostics and errors' },
          { link: '/reference/compatibility-and-security', text: 'Compatibility and security' },
        ],
        text: 'Reference',
      },
    ],
  },
  socialLinks: [{ icon: 'github', link: 'https://github.com/wh1teAlter/wws' }],
}

export default defineConfig({
  description: 'SharedWorker-first WebSocket connection sharing.',
  lastUpdated: true,
  themeConfig,
  title: 'wws',
})
