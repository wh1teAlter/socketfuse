---
title: 演练场
---

<script setup lang="ts">
import PlaygroundPanel from './playground/components/PlaygroundPanel.vue'
</script>

# 演练场

使用本页观察两个同源标签页之间的 WWS 连接共享。默认 endpoint 是
`ws://127.0.0.1:8787/socket`，只用于本地 E2E/演示服务；在仓库根目录的两个终端分别运行
`pnpm dev` 和 `pnpm playground:server` 后即可使用。在本地开发环境之外，请填写你自己的
WebSocket URL。

<ClientOnly>
  <PlaygroundPanel />
  <template #fallback>
    <p>正在加载仅在浏览器中运行的演练场…</p>
  </template>
</ClientOnly>

只有点击“连接”后才会创建连接。使用相同 URL 与 `id` 打开另一个标签页，即可看到由
SharedWorker 持有的同一个物理连接。选择 `direct` 可观察有意设置的构造/初始化降级；选择
`error` 则会直接显示该失败，不会打开另一个物理 socket。

“物理连接数”表示当前页面观测到的已打开 WebSocket 数：在 SharedWorker 传输下，使用相同
URL 与 `id` 的多个标签页都应显示 `1`。“共享页面数”是附着到这个共享连接的逻辑页面 client
数量，因此新增标签页后会增长；它不是物理 WebSocket 数。当前页面断开后会停止观测这两个共享
指标，并显示 `-`；仍连接的标签页会继续刷新自己的指标。
