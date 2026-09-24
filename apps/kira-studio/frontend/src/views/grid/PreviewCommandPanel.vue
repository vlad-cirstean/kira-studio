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
  // F18 (P108 Part 10): the key carries no pending-set version, so a stale cache entry from a
  // previous open would otherwise show for a moment (isLoading false while data exists) — this
  // component fully unmounts on close (DataView.vue's v-if="previewOpen"), so gcTime: 0 discards
  // the cache entry immediately and the next open starts empty until its own fetch lands.
  gcTime: 0,
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
  <PopoverContent align="end" class="w-120 gap-0 p-0" data-testid="preview-command-panel">
    <div class="preview-panel-inner">
      <div class="preview-panel-header flex items-center shrink-0 h-control-lg gap-1 px-1.5 border-b border-border text-kira-sm text-muted-foreground uppercase tracking-wider">
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
      <div v-if="isLoading" class="preview-panel-loading p-sm text-muted-foreground">Loading…</div>
      <div
        v-else-if="errorMessage"
        class="preview-panel-error p-sm"
        data-testid="preview-command-error"
      >
        {{ errorMessage }}
      </div>
      <div v-else-if="statements.length === 0" class="preview-panel-empty p-sm text-muted-foreground">
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
  @apply max-h-96 flex flex-col;
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
  @apply h-60;
}
</style>
