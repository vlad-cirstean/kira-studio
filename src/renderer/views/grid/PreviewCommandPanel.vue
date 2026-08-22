<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectionsState } from '../../state/connections';
import { findDataTab } from '../../state/tabs';
import { previewPending } from './pendingChanges';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ close: [] }>();

const statements = ref<string[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const doc = computed(() => statements.value.join(';\n') + (statements.value.length ? ';' : ''));

const sqlDialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  const tab = findDataTab(props.tabId);
  if (!tab?.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === tab.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

onMounted(async () => {
  const tab = findDataTab(props.tabId);
  if (!tab?.connectionId) {
    loading.value = false;
    return;
  }
  try {
    statements.value = await previewPending(tab.connectionId, tab.path, props.tabId);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
});

function close(): void {
  emit('close');
}
</script>

<template>
  <div class="menu-backdrop" data-testid="preview-command-backdrop" @click="close">
    <div class="preview-panel" data-testid="preview-command-panel" @click.stop>
      <div class="preview-panel-header">
        Preview command
        <button type="button" data-testid="preview-command-close" @click="close">×</button>
      </div>
      <div v-if="loading" class="preview-panel-loading">Loading…</div>
      <div v-else-if="error" class="preview-panel-error" data-testid="preview-command-error">
        {{ error }}
      </div>
      <div v-else-if="statements.length === 0" class="preview-panel-empty">
        No pending changes.
      </div>
      <div v-else class="preview-panel-body">
        <CodeMirrorHost :doc="doc" language="sql" :sql-dialect="sqlDialect" :read-only="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.preview-panel {
  position: absolute;
  top: 32px;
  right: 8px;
  width: 480px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 12px;
}

.preview-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-weight: 600;
}

.preview-panel-header button {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.preview-panel-loading,
.preview-panel-empty {
  padding: 12px;
  color: var(--kira-fg-muted);
}

.preview-panel-error {
  padding: 12px;
  color: var(--kira-error);
}

.preview-panel-body {
  height: 240px;
}
</style>
