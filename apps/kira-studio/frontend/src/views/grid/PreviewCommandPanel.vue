<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useTabsStore } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import { usePendingChangesStore } from './pendingChanges';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ close: [] }>();

const pendingChangesStore = usePendingChangesStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();

// P99 §5.5: a plain preview of the *currently staged* edits — nothing pushes a change event for
// it, and it must reflect this open's own pending state, so default staleTime (always refetch on
// mount) replaces the old ref([])/loading/error triple rather than staleTime: Infinity.
const { data, isLoading, error } = useQuery(() => ({
  queryKey: ['previewPending', props.tabId] as const,
  queryFn: () => {
    const tab = tabsStore.findDataTab(props.tabId);
    if (!tab?.connectionId) return Promise.resolve([]);
    return pendingChangesStore.previewPending(tab.connectionId, tab.path, props.tabId);
  },
  enabled: !!tabsStore.findDataTab(props.tabId)?.connectionId,
}));

const statements = computed(() => data.value ?? []);
const errorMessage = computed(() => {
  const err = error.value;
  if (!err) return null;
  return err instanceof Error ? err.message : String(err);
});

// P31 D40/F36: a blank line between statements — the trailing `;` on the last one is unchanged.
const doc = computed(() => statements.value.join(';\n\n') + (statements.value.length ? ';' : ''));

const sqlDialect = computed(() =>
  sqlDialectFor(connectionsStore.connectionRecord(tabsStore.findDataTab(props.tabId)?.connectionId)?.kind),
);

function close(): void {
  emit('close');
}
</script>

<template>
  <PopoverPanel
    anchor="right"
    :width="480"
    test-id="preview-command-panel"
    backdrop-test-id="preview-command-backdrop"
    @close="close"
  >
    <div class="preview-panel-inner">
      <div class="preview-panel-header p-panel-head">
        <span class="icon-box"><CodiconIcon name="code" :size="13" /></span>
        <span>Preview SQL</span>
        <IconButton
          icon="close"
          class="p-push"
          v-tooltip="'Close'"
          data-testid="preview-command-close"
          @click="close"
        />
      </div>
      <div v-if="isLoading" class="preview-panel-loading p-sm muted">Loading…</div>
      <div
        v-else-if="errorMessage"
        class="preview-panel-error p-sm"
        data-testid="preview-command-error"
      >
        {{ errorMessage }}
      </div>
      <div v-else-if="statements.length === 0" class="preview-panel-empty p-sm muted">
        No pending changes.
      </div>
      <div v-else class="preview-panel-body">
        <MonacoHost :doc="doc" language="sql" :sql-dialect="sqlDialect" :read-only="true" />
      </div>
    </div>
  </PopoverPanel>
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
