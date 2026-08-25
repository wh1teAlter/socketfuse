/**
 * 文档站主题入口。
 *
 * 只扩展默认 VitePress 主题并加载站点样式；playground 组件由页面自身按需引入，
 * 避免全站注册产生副作用。
 */
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'

/** VitePress 默认主题的最小扩展。 */
const theme: Theme = {
  extends: DefaultTheme,
}

export default theme
