<script setup lang="ts">
import { computed } from 'vue';
import Codicon from '../../theme/Codicon.vue';
import { load, runtime } from './state';

const props = defineProps<{ tabId: string }>();

const rt = computed(() => runtime[props.tabId]);
const loading = computed(() => rt.value?.status === 'loading');

function onRefresh(): void {
  void load(props.tabId, { refresh: true });
}
</script>

<template>
  <div class="ddl-toolbar" data-testid="ddl-toolbar">
    <button
      type="button"
      title="Refresh"
      data-testid="ddl-refresh"
      :disabled="loading"
      @click="onRefresh"
    >
      <Codicon name="refresh" :size="14" />
      Refresh
    </button>
  </div>
</template>

<style scoped>
.ddl-toolbar {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  font-size: 12px;
}

.ddl-toolbar > button {
  display: flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 3px 5px;
  border-radius: var(--kira-radius-sm);
}

.ddl-toolbar > button:hover:not(:disabled) {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.ddl-toolbar > button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
