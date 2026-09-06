<script setup lang="ts">
import { grpcCodeClass, grpcCodeHint } from '@shared/domain/grpc';
import {
  GRPC_HISTORY_PER_SCOPE_LIMIT,
  type GrpcCallHistoryEntry,
} from '@shared/domain/grpc-history';
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, ref } from 'vue';
import { formatRelative } from '../../format';
import { confirmDialog } from '../../state/confirmDialog';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import PanelSearchBox from '../../theme/primitives/PanelSearchBox.vue';
import {
  clearGrpcHistory,
  deleteGrpcHistoryEntry,
  ensureGrpcHistoryFresh,
  grpcHistoryRuntime,
  viewGrpcHistoryEntry,
} from './history';

// P13 D12: extracted out of ResponsePane.vue's own history block, mirroring
// views/httprequest/ResponseHistoryList.vue's shape exactly — a real toolbar (count + Clear,
// P12's own clearGrpcHistory finally reachable), rows as a <div> rather than a <button> nested
// inside a <button> (F20 — invalid HTML the parser silently hoisted the delete control out of),
// is-viewing highlighting, and formatRelative instead of an absolute toLocaleTimeString.
//
// No Compare: HTTP's rides @codemirror/merge over two response *bodies*; a gRPC call is a
// message *sequence* with metadata, a genuinely different design left for a future row (§5).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

const rt = computed(() => grpcHistoryRuntime[props.tab.id]);
const entries = computed<GrpcCallHistoryEntry[]>(() => rt.value?.entries ?? []);
const viewingId = computed(() => rt.value?.viewing?.id ?? null);
// P18 D6: HTTP's own "the list is full" predicate, restated for gRPC's cap.
const atCap = computed(() => entries.value.length >= GRPC_HISTORY_PER_SCOPE_LIMIT);

onMounted(() => {
  ensureGrpcHistoryFresh(props.tab.id);
});

// P22b D14: HTTP's own ResponseHistoryList.vue idiom (P16 D15) — an always-visible filter box
// above the list, not a toggle (a compact history pane, not a big document). Matches method,
// status name, and time — case-folded substring, the fields already on screen in each row.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const filteredEntries = computed<GrpcCallHistoryEntry[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) =>
      e.method.toLowerCase().includes(q) ||
      e.codeName.toLowerCase().includes(q) ||
      formatRelative(e.calledAt).toLowerCase().includes(q),
  );
});

function onRowClick(id: string): void {
  void viewGrpcHistoryEntry(props.tab.id, id);
}

function onDelete(id: string): void {
  void deleteGrpcHistoryEntry(props.tab.id, id);
}

async function onClear(): Promise<void> {
  const ok = await confirmDialog('Clear this request’s call history? This cannot be undone.', {
    danger: true,
  });
  if (ok) await clearGrpcHistory(props.tab.id);
}
</script>

<template>
  <div class="history-pane" data-testid="grpc-history-list">
    <div class="history-toolbar p-toolbar">
      <span class="p-xs dim">{{ entries.length }} {{ entries.length === 1 ? 'call' : 'calls' }}</span>
      <span class="p-push" />
      <AppButton
        icon="trash"
        :disabled="entries.length === 0"
        data-testid="grpc-history-clear"
        @click="onClear"
      >
        Clear history
      </AppButton>
    </div>

    <MessageStrip v-if="rt?.error" tone="err">{{ rt.error }}</MessageStrip>
    <EmptyState v-else-if="entries.length === 0" icon="history" label="No past calls yet" />

    <template v-else>
      <PanelSearchBox
        v-model="filterQuery"
        placeholder="Filter history"
        testid="grpc-history-filter"
      />
      <EmptyState
        v-if="isFiltered && filteredEntries.length === 0"
        icon="search"
        label="No matches"
        data-testid="grpc-history-filter-empty"
      />
    </template>

    <div v-if="entries.length > 0 && filteredEntries.length > 0" class="history-rows">
      <div
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="history-row"
        :class="{ 'is-viewing': entry.id === viewingId }"
        data-testid="grpc-history-row"
        @click="onRowClick(entry.id)"
      >
        <span
          class="p-chip"
          :class="grpcCodeClass(entry.code)"
          v-tooltip="grpcCodeHint(entry.code)"
          >{{ entry.codeName }}</span
        >
        <span class="p-xs mono">{{ entry.method }}</span>
        <span v-tooltip="entry.calledAt" class="p-xs dim">{{ formatRelative(entry.calledAt) }}</span>
        <span class="p-push" />
        <IconButton
          icon="trash"
          v-tooltip="'Delete'"
          data-testid="grpc-history-delete"
          @click.stop="onDelete(entry.id)"
        />
      </div>
    </div>

    <div v-if="atCap" class="p-xs dim history-cap-note" data-testid="grpc-history-cap-note">
      Only the last {{ GRPC_HISTORY_PER_SCOPE_LIMIT }} are kept — older calls are removed
      automatically.
    </div>
  </div>
</template>

<style scoped>
.history-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.history-toolbar {
  gap: var(--kira-s-2);
}

.history-rows {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.history-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  cursor: pointer;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.history-row:hover,
.history-row.is-viewing {
  background: var(--kira-hover);
}

.history-cap-note {
  flex-shrink: 0;
  padding: var(--kira-s-2) var(--kira-s-3);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
