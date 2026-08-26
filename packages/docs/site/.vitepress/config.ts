/**
 * VitePress 文档站配置。
 *
 * 导航按指南、API、协议、参考和演练场分区；API 页面引用构建
 * 生成的 TypeDoc Markdown，避免手写签名与源码漂移。
 */
import { type DefaultTheme, defineConfig } from 'vitepress'

/** 文档站导航、侧栏、搜索与页脚配置。 */
const themeConfig: DefaultTheme.Config = {
  darkModeSwitchLabel: '外观',
  darkModeSwitchTitle: '切换为深色主题',
  docFooter: { next: '下一页', prev: '上一页' },
  footer: {
    copyright: '版权所有 © 2026 SocketFuse 贡献者',
    message: '基于 MIT 许可证发布。',
  },
  lastUpdated: {
    formatOptions: { dateStyle: 'long', forceLocale: true, timeStyle: 'short' },
    text: '最后更新',
  },
  lightModeSwitchTitle: '切换为浅色主题',
  nav: [
    { activeMatch: '^/guide/', link: '/guide/', text: '指南' },
    { activeMatch: '^/api/', link: '/api/', text: 'API' },
    { activeMatch: '^/protocols/', link: '/protocols/', text: '协议' },
    { activeMatch: '^/reference/', link: '/reference/configuration', text: '参考' },
    { link: '/playground', text: '演练场' },
  ],
  outline: { level: [2, 3], label: '本页目录' },
  notFound: {
    linkLabel: '返回首页',
    linkText: '带我回首页',
    quote: '页面可能已移动，或地址有误。',
    title: '未找到页面',
  },
  returnToTopLabel: '返回顶部',
  search: {
    options: {
      translations: {
        button: { buttonAriaLabel: '搜索文档', buttonText: '搜索' },
        modal: {
          backButtonTitle: '清除搜索',
          displayDetails: '显示详细列表',
          footer: {
            closeKeyAriaLabel: 'Esc 键',
            closeText: '关闭',
            navigateDownKeyAriaLabel: '向下箭头',
            navigateText: '选择',
            navigateUpKeyAriaLabel: '向上箭头',
            resetButtonTitle: '重置搜索',
            selectKeyAriaLabel: '回车键',
          },
          noResultsText: '未找到相关结果',
          resetButtonTitle: '重置搜索',
        },
      },
    },
    provider: 'local',
  },
  sidebarMenuLabel: '菜单',
  skipToContentLabel: '跳到正文',
  sidebar: {
    '/api/': [
      {
        items: [
          { link: '/api/', text: '概览' },
          { link: '/api/generated/index/README.md', text: 'socketfuse 入口' },
          { link: '/api/generated/protocol/README.md', text: 'socketfuse/protocol' },
          { link: '/api/generated/worker/README.md', text: 'socketfuse/worker' },
        ],
        text: 'API 参考',
      },
    ],
    '/guide/': [
      {
        items: [
          { link: '/guide/', text: '简介' },
          { link: '/guide/getting-started', text: '快速开始' },
          { link: '/guide/connection-sharing', text: '连接共享' },
          { link: '/guide/reliability', text: '可靠性' },
          { link: '/guide/lifecycle-and-replay', text: '生命周期与回放' },
          { link: '/guide/fallback-and-worker', text: '降级与 Worker' },
        ],
        text: '指南',
      },
    ],
    '/protocols/': [
      {
        items: [
          { link: '/protocols/', text: '概览' },
          { link: '/protocols/raw', text: '原始协议' },
          { link: '/protocols/json', text: 'JSON 协议' },
          { link: '/protocols/custom-adapter', text: '自定义适配器' },
        ],
        text: '协议',
      },
    ],
    '/reference/': [
      {
        items: [
          { link: '/reference/configuration', text: '配置' },
          { link: '/reference/events-and-client', text: '事件与客户端' },
          { link: '/reference/diagnostics-and-errors', text: '诊断与错误' },
          { link: '/reference/compatibility-and-security', text: '兼容性与安全' },
        ],
        text: '参考',
      },
    ],
  },
  socialLinks: [{ icon: 'github', link: 'https://github.com/wh1teAlter/socketfuse' }],
}

export default defineConfig({
  description: '基于 SharedWorker 的同源多标签页 WebSocket 连接共享。',
  lang: 'zh-CN',
  lastUpdated: true,
  themeConfig,
  title: 'SocketFuse',
})
