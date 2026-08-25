<script setup lang="ts">
/**
 * Playground 消息列表展示组件。
 *
 * 列表只渲染 composable 提供的快照，并通过 clear 事件请求清空；不会修改消息对象
 * 或参与协议解码。
 */
import type { PlaygroundMessage } from '../composables/usePlaygroundConnection'

/** 消息列表的只读展示输入。 */
const props = defineProps<{
  count: number
  messages: readonly PlaygroundMessage[]
}>()

/** 列表操作事件。 */
const emit = defineEmits<{
  clear: []
}>()
</script>

<template>
  <section class="playground-console">
    <div class="playground-console-header">
      <div>
        <h3 class="playground-console-title">
          消息
        </h3>
        <p class="playground-console-count">
          已接收 {{ props.count }} 条
        </p>
      </div>
      <button
        class="playground-clear"
        type="button"
        @click="emit('clear')"
      >
        清空
      </button>
    </div>
    <ol
      id="messages"
      class="playground-messages"
      aria-live="polite"
    >
      <li
        v-for="message in props.messages"
        :key="message.id"
        class="playground-message"
      >
        <span
          v-if="message.replayed"
          class="playground-replayed"
        >[已回放]</span>
        <span
          v-if="message.type === 'binary'"
          class="playground-replayed"
        >[二进制]</span>
        {{ message.value }}
      </li>
    </ol>
  </section>
</template>

<style scoped>
.playground-console {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.5rem;
  min-height: 15rem;
  padding: 1rem;
}

.playground-console-header {
  align-items: start;
  display: flex;
  justify-content: space-between;
}

.playground-console-title,
.playground-console-count {
  margin: 0;
}

.playground-console-title {
  font-size: 1rem;
}

.playground-console-count {
  color: var(--vp-c-text-2);
  font-size: 0.8125rem;
  margin-top: 0.25rem;
}

.playground-clear {
  background: transparent;
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.375rem;
  color: var(--vp-c-text-1);
  cursor: pointer;
  font: inherit;
  padding: 0.375rem 0.625rem;
}

.playground-messages {
  display: grid;
  gap: 0.5rem;
  margin: 1rem 0 0;
  max-height: 22.5rem;
  overflow: auto;
  padding-left: 1.5rem;
}

.playground-message {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 0.8125rem;
  overflow-wrap: anywhere;
}

.playground-replayed {
  color: var(--vp-c-brand-1);
  margin-right: 0.375rem;
}
</style>
