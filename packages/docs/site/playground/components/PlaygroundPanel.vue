<script setup lang="ts">
/**
 * Playground 页面组合组件。
 *
 * 连接状态由 composable 持有，表单和消息列表通过 props/events 通信；本组件只负责
 * 组合布局与指标展示，不直接操作 Worker 或 WebSocket。
 */
import { usePlaygroundConnection } from '../composables/usePlaygroundConnection'
import PlaygroundConnectionForm from './PlaygroundConnectionForm.vue'
import PlaygroundMessages from './PlaygroundMessages.vue'

const {
  clearMessages,
  clients,
  connect,
  connectionId,
  disconnect,
  error,
  fallback,
  isConnected,
  messageCount,
  messages,
  openAnotherTab,
  replayWhileHidden,
  sendBinaryMessage,
  sendMessage,
  simulateWorkerFailure,
  status,
  transport,
  url,
} = usePlaygroundConnection()
</script>

<template>
  <div class="playground-panel">
    <PlaygroundConnectionForm
      :connection-id="connectionId"
      :fallback="fallback"
      :is-connected="isConnected"
      :replay-while-hidden="replayWhileHidden"
      :simulate-worker-failure="simulateWorkerFailure"
      :url="url"
      @connect="connect"
      @disconnect="disconnect"
      @open-another-tab="openAnotherTab"
      @send="sendMessage"
      @send-binary="sendBinaryMessage($event)"
      @update:connection-id="connectionId = $event"
      @update:fallback="fallback = $event"
      @update:replay-while-hidden="replayWhileHidden = $event"
      @update:simulate-worker-failure="simulateWorkerFailure = $event"
      @update:url="url = $event"
    />

    <section
      class="playground-metrics"
      aria-live="polite"
    >
      <div class="playground-metric">
        <span>传输方式</span><strong id="transport">{{ transport }}</strong>
      </div>
      <div class="playground-metric">
        <span>状态</span><strong id="status">{{ status }}</strong>
      </div>
      <div class="playground-metric">
        <span>物理客户端数</span><strong id="clients">{{ clients }}</strong>
      </div>
      <div class="playground-metric">
        <span>消息数</span><strong id="message-count">{{ messageCount }}</strong>
      </div>
    </section>

    <PlaygroundMessages
      :count="messageCount"
      :messages="messages"
      @clear="clearMessages"
    />
    <p
      id="error"
      class="playground-error"
      role="status"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped>
.playground-panel {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.75rem;
  display: grid;
  gap: 1rem;
  margin: 1.5rem 0;
  padding: 1.25rem;
}

.playground-metrics {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.playground-metric {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  min-width: 0;
  padding: 0.75rem;
}

.playground-metric span,
.playground-metric strong {
  display: block;
}

.playground-metric span {
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  margin-bottom: 0.375rem;
}

.playground-metric strong {
  overflow-wrap: anywhere;
}

.playground-error {
  color: var(--vp-c-danger-1);
  margin: 0;
  min-height: 1.5rem;
}

@media (max-width: 640px) {
  .playground-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
