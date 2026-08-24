import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'
import PlaygroundPanel from './components/playground/PlaygroundPanel.vue'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('PlaygroundPanel', PlaygroundPanel)
  },
}

export default theme
