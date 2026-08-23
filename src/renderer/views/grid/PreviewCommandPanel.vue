<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectionsState } from '../../state/connections';
import { findDataTab } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import Popover from '../../theme/primitives/Popover.vue';
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
  <Popover
    anchor="right"
    :width="480"
    test-id="preview-command-panel"
    backdrop-test-id="preview-command-backdrop"
    @close="close"
  >
    <div class="preview-panel-inner">
      <div class="preview-panel-header p-panel-head">
        <span class="icon-box"><Codicon name="code" :size="14" /></span>
        <span>Preview SQL</span>
        <button
          type="button"
          class="p-iconbtn p-push"
          title="Close"
          data-testid="preview-command-close"
          @click="close"
        >
          <Codicon name="close" :size="14" />
        </button>
      </div>
      <div v-if="loading" class="preview-panel-loading p-sm muted">Loading…</div>
      <div v-else-if="error" class="preview-panel-error p-sm" data-testid="preview-command-error">
        {{ error }}
      </div>
      <div v-else-if="statements.length === 0" class="preview-panel-empty p-sm muted">
        No pending changes.
      </div>
      <div v-else class="preview-panel-body">
        <CodeMirrorHost :doc="doc" language="sql" :sql-dialect="sqlDialect" :read-only="true" />
      </div>
    </div>
  </Popover>
</template>

<style scoped>
.preview-panel-inner {
  max-height: 360px;
  display: flex;
  flex-direction: column;
}

.preview-panel-header {
  text-transform: none;
  letter-spacing: normal;
}

.preview-panel-loading,
.preview-panel-empty {
  padding: var(--kira-s-4);
}

.preview-panel-error {
  padding: var(--kira-s-4);
  color: var(--kira-error);
}

.preview-panel-body {
  height: 240px;
}
</style>
