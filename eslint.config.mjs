import { defineConfig, globalIgnores } from 'eslint/config'
import unusedImports from 'eslint-plugin-unused-imports'
import perfectionist from 'eslint-plugin-perfectionist'
import importPlugin from 'eslint-plugin-import-lite'
import stylistic from '@stylistic/eslint-plugin'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'
import jsonc from 'eslint-plugin-jsonc'
import globals from 'globals'
import js from '@eslint/js'

const sourceFiles = ['**/*.{js,mjs,ts,vue}']
const typescriptFiles = ['**/*.{ts,mts,cts}']

export default defineConfig(
  globalIgnores([
    '**/.vitepress/cache/**',
    '**/.vitepress/dist/**',
    '**/coverage/**',
    '**/dist/**',
    '**/node_modules/**',
    '**/playwright-report/**',
    '**/test-results/**',
    'packages/wws/src/inline-worker-source.generated.ts',
  ]),
  ...jsonc.configs['flat/recommended-with-jsonc'],
  {
    files: sourceFiles,
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      stylistic.configs.customize({
        commaDangle: 'always-multiline',
        indent: 2,
        quotes: 'single',
        semi: false,
      }),
    ],
    languageOptions: {
      globals: globals.es2022,
      parserOptions: {
        parser: tseslint.parser,
      },
      sourceType: 'module',
    },
    plugins: {
      'import': importPlugin,
      perfectionist,
      'unused-imports': unusedImports,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/unified-signatures': 'off',
      'import/no-duplicates': ['error', { 'prefer-inline': true }],
      'perfectionist/sort-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-imports': ['error', { newlinesBetween: 0, order: 'desc', type: 'line-length' }],
      'perfectionist/sort-named-exports': ['error', { type: 'natural' }],
      'perfectionist/sort-named-imports': ['error', { type: 'natural' }],
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': 'error',
    },
  },
  {
    files: typescriptFiles,
    languageOptions: {
      parser: tseslint.parser,
    },
  },
  {
    files: ['packages/{core,wws}/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
      },
    },
  },
  {
    files: ['packages/docs/**/*.{ts,vue}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['packages/docs/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['**/*.config.{mjs,ts}', 'packages/test/**/*.{mjs,ts}', 'scripts/**/*.{mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['packages/docs/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/require-default-prop': 'off',
    },
  },
)
