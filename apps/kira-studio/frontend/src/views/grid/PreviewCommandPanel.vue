<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { PopoverContent } from '@theme/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useTabsStore } from '../../state/tabs';
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
  <PopoverContent align="end" class="w-[480px] gap-0 p-0" data-testid="preview-command-panel">
    <div class="preview-panel-inner">
      <div class="preview-panel-header p-panel-head">
        <span class="icon-box"><CodiconIcon name="code" :size="13" /></span>
        <span>Preview SQL</span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              class="p-push"
              aria-label="Close"
              data-testid="preview-command-close"
              @click="close"
            >
              <CodiconIcon name="close" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </Tooltip>
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
  </PopoverContent>
</template>

<style scoped>
@reference "@theme/base.css";

.preview-panel-inner {
  @apply max-h-[360px] flex flex-col;
}

.preview-panel-header {
  @apply normal-case tracking-normal;
}

.preview-panel-loading,
.preview-panel-empty {
  @apply p-2;
}

.preview-panel-error {
  @apply text-error p-2;
}

.preview-panel-body {
  @apply h-[240px];
}
</style>
