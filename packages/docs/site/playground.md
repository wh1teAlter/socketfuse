---
title: 演练场
---

<script setup lang="ts">
import PlaygroundPanel from './playground/components/PlaygroundPanel.vue'
</script>

# 演练场

使用本页观察两个同源标签页之间的 WWS 连接共享。默认的 `ws://localhost:8787` endpoint
只用于本地 E2E/演示服务；在本地开发环境之外，请填写你自己的 WebSocket URL。

<ClientOnly>
  <PlaygroundPanel />
  <template #fallback>
    <p>正在加载仅在浏览器中运行的演练场…</p>
  </template>
</ClientOnly>

只有点击“连接”后才会创建连接。使用相同 URL 与 `id` 打开另一个标签页，即可看到由
SharedWorker 持有的同一个物理连接。选择 `direct` 可观察有意设置的构造/初始化降级；选择
`error` 则会直接显示该失败，不会打开另一个物理 socket。
