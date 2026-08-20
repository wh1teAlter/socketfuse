import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  formatters: {
    css: true,
    html: true,
    markdown: 'prettier',
  },
  ignores: [
    '**/dist',
    '**/coverage',
    '**/playwright-report',
    '**/test-results',
    'packages/wws/src/inline-worker-source.generated.ts',
  ],
  stylistic: {
    indent: 2,
    quotes: 'single',
  },
  typescript: true,
})
