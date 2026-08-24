<script setup lang="ts">
import { shallowRef } from 'vue'

const props = defineProps<{
  connectionId: string
  fallback: 'direct' | 'error'
  isConnected: boolean
  replayWhileHidden: boolean
  simulateWorkerFailure: boolean
  url: string
}>()

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
  'update:url': [value: string]
}>()

const payload = shallowRef('')

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
          wws playground
        </p>
        <h2 class="playground-title">
          Shared WebSocket console
        </h2>
      </div>
      <button
        class="playground-button playground-button-secondary"
        type="button"
        @click="emit('openAnotherTab')"
      >
        Open another tab
      </button>
    </header>

    <section
      class="playground-toolbar"
      aria-label="Connection controls"
    >
      <label class="playground-field">
        <span>URL</span>
        <input
          :value="props.url"
          @input="emit('update:url', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="playground-field">
        <span>Connection id</span>
        <input
          :value="props.connectionId"
          @input="emit('update:connectionId', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="playground-toggle">
        <input
          :checked="props.replayWhileHidden"
          type="checkbox"
          @change="emit('update:replayWhileHidden', ($event.target as HTMLInputElement).checked)"
        >
        <span>Replay while hidden</span>
      </label>
      <label class="playground-toggle">
        <input
          :checked="props.simulateWorkerFailure"
          type="checkbox"
          @change="emit('update:simulateWorkerFailure', ($event.target as HTMLInputElement).checked)"
        >
        <span>Simulate Worker init failure</span>
      </label>
      <label class="playground-field playground-select">
        <span>Fallback</span>
        <select
          :value="props.fallback"
          @change="emit('update:fallback', ($event.target as HTMLSelectElement).value as 'direct' | 'error')"
        >
          <option value="direct">direct</option>
          <option value="error">error</option>
        </select>
      </label>
      <button
        class="playground-button"
        :disabled="props.isConnected"
        type="button"
        @click="emit('connect')"
      >
        Connect
      </button>
      <button
        class="playground-button playground-button-secondary"
        :disabled="!props.isConnected"
        type="button"
        @click="emit('disconnect')"
      >
        Disconnect
      </button>
    </section>

    <form
      class="playground-send-form"
      @submit.prevent="send"
    >
      <input
        v-model="payload"
        autocomplete="off"
        placeholder="Message payload"
      >
      <button
        class="playground-button"
        type="submit"
      >
        Send
      </button>
      <button
        class="playground-button playground-button-secondary"
        type="button"
        @click="emit('sendBinary', 'typed-array')"
      >
        Send typed array
      </button>
      <button
        class="playground-button playground-button-secondary"
        type="button"
        @click="emit('sendBinary', 'array-buffer')"
      >
        Send ArrayBuffer
      </button>
      <button
        class="playground-button playground-button-secondary"
        type="button"
        @click="emit('sendBinary', 'blob')"
      >
        Send Blob
      </button>
    </form>
  </div>
</template>

<style scoped>
.playground-controls {
  display: grid;
  gap: 1rem;
}

.playground-header,
.playground-toolbar,
.playground-send-form {
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
  align-items: end;
  flex-wrap: wrap;
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
  min-width: 12rem;
  padding: 0.5rem 0.625rem;
}

.playground-toggle {
  align-items: center;
  display: flex;
  gap: 0.375rem;
  min-height: 2.25rem;
}

.playground-button {
  background: var(--vp-c-brand-1);
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 0.375rem;
  color: var(--vp-c-white);
  cursor: pointer;
  font: inherit;
  padding: 0.5rem 0.75rem;
}

.playground-button-secondary {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
}

.playground-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.playground-send-form input {
  flex: 1;
}

@media (max-width: 640px) {
  .playground-header,
  .playground-toolbar,
  .playground-send-form {
    align-items: stretch;
    flex-direction: column;
  }

  .playground-field input,
  .playground-field select {
    width: 100%;
  }
}
</style>
