---
title: 演练场
---

<script setup lang="ts">
import PlaygroundPanel from './playground/components/PlaygroundPanel.vue'
</script>

# 演练场

使用本页观察两个同源标签页之间的 SocketFuse 连接共享。默认 endpoint 是
`ws://127.0.0.1:8787/socket`，只用于本地 E2E/演示服务；在仓库根目录的两个终端分别运行
`pnpm dev` 和 `pnpm playground:server` 后即可使用；首次克隆先运行 `pnpm install --frozen-lockfile` 和 `pnpm build`。在本地开发环境之外，请填写你自己的
WebSocket URL。

<ClientOnly>
  <PlaygroundPanel />
  <template #fallback>
    <p>正在加载仅在浏览器中运行的演练场…</p>
  </template>
</ClientOnly>

只有点击“连接”后才会创建连接。使用相同 `id`、共享配置和 Worker 部署打开另一个同源标签页，即可看到由
SharedWorker 持有的同一个物理连接。内置 Worker 不可用时，`direct` 策略允许页面内连接，
`error` 策略则报告失败。勾选“模拟自定义 Worker 失败”会强制使用 `error`：自定义协议部署
不能在页面里自动重建，因此始终显式失败。

“物理连接数”表示当前页面观测到的已打开 WebSocket 数：在 SharedWorker 传输下，使用相同
`id` 和共享配置的多个标签页都应显示 `1`。“共享页面数”是附着到这个共享连接的逻辑页面 client
数量，因此新增标签页后会增长；它不是物理 WebSocket 数。当前页面断开后会停止观测这两个共享
指标，并显示 `-`；仍连接的标签页会继续刷新自己的指标。
