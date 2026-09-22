<script setup lang="ts">
/**
 * Playground 连接与发送表单。
 *
 * 所有输入通过 props 下发、事件上报；组件不持有连接副作用，仅保留文本输入框的
 * 临时值，避免把业务状态复制到展示层。
 */
import { shallowRef } from 'vue'

/** 表单接收的连接配置和当前状态。 */
const props = defineProps<{
  connectionId: string
  fallback: 'direct' | 'error'
  isConnected: boolean
  replayWhileHidden: boolean
  simulateWorkerFailure: boolean
  simulateWorkerUnsupported: boolean
  url: string
}>()

/** 表单向组合组件发出的用户操作事件。 */
const emit = defineEmits<{
  'connect': []
  'disconnect': []
  'openAnotherTab': []
  'send': [payload: string]
  'sendBinary': [kind: 'array-buffer' | 'blob' | 'typed-array']
  'update:connectionId': [value: string]
  'update:fallback': [value: 'direct' | 'error']
  'update:replayWhileHidden': [value: boolean]
  'update:simulateWorkerFailure': [value: boolean]
  'update:simulateWorkerUnsupported': [value: boolean]
  'update:url': [value: string]
}>()

/** 提交当前非空文本 payload。 */
const payload = shallowRef('')

/** 发出文本发送事件并清空输入框。 */
function send(): void {
  if (payload.value.length === 0)
    return
  emit('send', payload.value)
  payload.value = ''
}
</script>

<template>
  <div class="playground-controls">
    <header class="playground-header">
      <div>
        <p class="playground-eyebrow">
          SocketFuse 演练场
        </p>
        <h2 class="playground-title">
          共享 WebSocket 控制台
        </h2>
      </div>
      <button
        class="playground-button playground-button-secondary"
        type="button"
        @click="emit('openAnotherTab')"
      >
        打开另一个标签页
      </button>
    </header>

    <section
      class="playground-toolbar"
      aria-label="连接控制"
    >
      <div class="playground-toolbar-fields">
        <label class="playground-field">
          <span>URL</span>
          <input
            :value="props.url"
            @input="emit('update:url', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="playground-field">
          <span>连接 id</span>
          <input
            :value="props.connectionId"
            @input="emit('update:connectionId', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <label class="playground-field playground-select">
          <span>降级策略</span>
          <select
            :disabled="props.simulateWorkerFailure"
            :value="props.simulateWorkerFailure ? 'error' : props.fallback"
            @change="emit('update:fallback', ($event.target as HTMLSelectElement).value as 'direct' | 'error')"
          >
            <option value="direct">direct</option>
            <option value="error">error</option>
          </select>
        </label>
      </div>
      <div class="playground-toolbar-options">
        <label class="playground-toggle">
          <input
            :checked="props.replayWhileHidden"
            type="checkbox"
            @change="emit('update:replayWhileHidden', ($event.target as HTMLInputElement).checked)"
          >
          <span>页面隐藏时回放</span>
        </label>
        <label class="playground-toggle">
          <input
            :checked="props.simulateWorkerFailure"
            :disabled="props.simulateWorkerUnsupported"
            type="checkbox"
            @change="emit('update:simulateWorkerFailure', ($event.target as HTMLInputElement).checked)"
          >
          <span>模拟自定义 Worker 失败（不降级）</span>
        </label>
        <label class="playground-toggle">
          <input
            :checked="props.simulateWorkerUnsupported"
            :disabled="props.simulateWorkerFailure"
            type="checkbox"
            @change="emit('update:simulateWorkerUnsupported', ($event.target as HTMLInputElement).checked)"
          >
          <span>模拟平台不支持 SharedWorker（按策略降级）</span>
        </label>
      </div>
      <div class="playground-toolbar-actions">
        <button
          class="playground-button"
          :disabled="props.isConnected"
          type="button"
          @click="emit('connect')"
        >
          连接
        </button>
        <button
          class="playground-button playground-button-secondary"
          :disabled="!props.isConnected"
          type="button"
          @click="emit('disconnect')"
        >
          断开连接
        </button>
      </div>
    </section>

    <form
      class="playground-send-form"
      @submit.prevent="send"
    >
      <div class="playground-send-main">
        <input
          v-model="payload"
          autocomplete="off"
          placeholder="消息内容"
        >
        <button
          class="playground-button"
          type="submit"
        >
          发送
        </button>
      </div>
      <div class="playground-binary-actions">
        <button
          class="playground-button playground-button-secondary"
          type="button"
          @click="emit('sendBinary', 'typed-array')"
        >
          发送类型化数组
        </button>
        <button
          class="playground-button playground-button-secondary"
          type="button"
          @click="emit('sendBinary', 'array-buffer')"
        >
          发送 ArrayBuffer
        </button>
        <button
          class="playground-button playground-button-secondary"
          type="button"
          @click="emit('sendBinary', 'blob')"
        >
          发送 Blob
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.playground-controls {
  display: grid;
  gap: 1rem;
}

.playground-header,
.playground-toolbar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
}

.playground-header {
  justify-content: space-between;
}

.playground-eyebrow {
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  margin: 0 0 0.25rem;
  text-transform: uppercase;
}

.playground-title {
  border: 0;
  margin: 0;
  padding: 0;
}

.playground-toolbar {
  align-items: stretch;
  display: grid;
  gap: 0.75rem 1rem;
}

.playground-toolbar-fields {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(7rem, 0.65fr);
}

.playground-toolbar-options {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  grid-column: 1 / -1;
}

.playground-toolbar-actions {
  justify-self: end;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(8rem, 1fr));
}

.playground-field,
.playground-toggle {
  color: var(--vp-c-text-2);
  font-size: 0.8125rem;
}

.playground-field {
  display: grid;
  gap: 0.25rem;
}

.playground-field input,
.playground-field select,
.playground-send-form input {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 0.375rem;
  color: var(--vp-c-text-1);
  font: inherit;
  min-width: 0;
  padding: 0.5rem 0.625rem;
  width: 100%;
}

.playground-toggle {
  align-items: center;
  display: flex;
  gap: 0.375rem;
  min-height: 2rem;
  white-space: nowrap;
}

.playground-button {
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.375rem;
  color: var(--vp-c-white);
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.75rem;
  white-space: nowrap;
}

.playground-button-secondary {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.playground-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.playground-send-form {
  display: grid;
  gap: 0.75rem;
}

.playground-send-main {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) auto;
}

.playground-binary-actions {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
}

.playground-binary-actions .playground-button {
  width: 100%;
}

@media (max-width: 640px) {
  .playground-header {
    align-items: stretch;
    flex-direction: column;
  }

  .playground-toolbar {
    grid-template-columns: 1fr;
  }

  .playground-toolbar-fields {
    grid-template-columns: 1fr;
  }

  .playground-toolbar-actions {
    justify-self: stretch;
  }

  .playground-field input,
  .playground-field select {
    width: 100%;
  }
}

@media (max-width: 420px) {
  .playground-send-main {
    grid-template-columns: 1fr;
  }

  .playground-send-main .playground-button {
    width: 100%;
  }

  .playground-toolbar-actions {
    grid-template-columns: 1fr;
  }
}
</style>
