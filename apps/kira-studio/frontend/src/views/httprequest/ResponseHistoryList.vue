<script setup lang="ts">
import { httpMethodClass, statusClass } from '@shared/domain/http';
import type { ResponseHistoryEntry } from '@shared/domain/response-history';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import { formatBytes, formatRelative } from '../../format';
import { confirmDialog } from '../../state/confirmDialog';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import {
  clearHistory,
  deleteHistoryEntry,
  ensureHistoryLoaded,
  historyRuntime,
  toggleSelected,
  viewHistoryEntry,
} from './history';

// P8 D15: the History pane's list — one row per response, capped at 20 by construction (D6), so
// no VirtualList/TreeHost involvement.
const props = defineProps<{ tab: HttpRequestTabRecord }>();
const emit = defineEmits<{ compare: [ids: [string, string]] }>();

const rt = computed(() => historyRuntime[props.tab.id]);
const entries = computed<ResponseHistoryEntry[]>(() => rt.value?.entries ?? []);
const selected = computed(() => rt.value?.selected ?? []);
const viewingId = computed(() => rt.value?.viewing?.id ?? null);
const isScratch = computed(() => !props.tab.state.itemId);

onMounted(() => {
  ensureHistoryLoaded(props.tab.id);
});

/** D15: the URL is shown on a second line only when it differs from the row above it — within
 *  one request's history the URL is usually identical, and repeating it twenty times is noise. */
function showUrl(i: number): boolean {
  return i === 0 || entries.value[i - 1]?.url !== entries.value[i]?.url;
}

// D10: "click views the entry" swaps the *whole* response pane, not just the runtime pointer —
// without switching back to Body, selecting a row would leave the user staring at the same list
// they just clicked in, with no visible sign anything happened.
function onRowClick(id: string): void {
  void viewHistoryEntry(props.tab.id, id);
  patchHttpRequestTabState(props.tab.id, { responsePane: 'body' });
}

function onToggle(id: string): void {
  toggleSelected(props.tab.id, id);
}

function onDelete(id: string): void {
  void deleteHistoryEntry(props.tab.id, id);
}

function onCompare(): void {
  const [a, b] = selected.value;
  if (a && b) emit('compare', [a, b]);
}

async function onClear(): Promise<void> {
  const ok = await confirmDialog('Clear this request’s response history? This cannot be undone.', {
    danger: true,
  });
  if (ok) await clearHistory(props.tab.id);
}
</script>

<template>
  <div class="history-pane" data-testid="http-history-list">
    <div class="history-toolbar p-toolbar">
      <span class="p-xs dim">{{ entries.length }} {{ entries.length === 1 ? 'response' : 'responses' }}</span>
      <span class="p-push" />
      <AppButton
        :disabled="selected.length !== 2"
        data-testid="http-history-compare"
        @click="onCompare"
      >
        Compare
      </AppButton>
      <AppButton
        icon="trash"
        :disabled="entries.length === 0"
        data-testid="http-history-clear"
        @click="onClear"
      >
        Clear history
      </AppButton>
    </div>

    <EmptyState
      v-if="entries.length === 0"
      icon="history"
      label="No past responses yet"
      data-testid="http-history-empty"
    >
      <span class="p-xs dim scratch-note">
        Sending this request will record one.
        <template v-if="isScratch">
          Scratch requests keep their history until the tab is closed — save this request to keep
          it.
        </template>
      </span>
    </EmptyState>

    <div v-else class="history-rows">
      <div
        v-for="(entry, i) in entries"
        :key="entry.id"
        class="history-row"
        :class="{ 'is-viewing': entry.id === viewingId }"
        data-testid="http-history-row"
        @click="onRowClick(entry.id)"
      >
        <input
          type="checkbox"
          class="history-checkbox"
          data-testid="http-history-checkbox"
          :checked="selected.includes(entry.id)"
          :disabled="!selected.includes(entry.id) && selected.length >= 2"
          @click.stop
          @change="onToggle(entry.id)"
        />
        <div class="history-row-main">
          <div class="history-row-line">
            <span v-tooltip="entry.sentAt" class="p-xs dim history-time">{{ formatRelative(entry.sentAt) }}</span>
            <span class="p-chip" :class="httpMethodClass(entry.method)">{{ entry.method }}</span>
            <span class="p-chip" :class="statusClass(entry.status)">{{ entry.status }} {{ entry.statusText }}</span>
            <span class="p-xs dim">{{ entry.elapsedMs }} ms</span>
            <span class="p-xs dim">{{ formatBytes(entry.bodyBytes) }}</span>
            <span v-if="entry.environment" class="p-xs dim">{{ entry.environment }}</span>
            <span class="p-push" />
            <IconButton
              icon="trash"
              data-testid="http-history-delete"
              @click.stop="onDelete(entry.id)"
            />
          </div>
          <div v-if="showUrl(i)" class="p-xs dim history-url">{{ entry.url }}</div>
        </div>
      </div>
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

.scratch-note {
  margin-top: var(--kira-s-1);
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
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  cursor: pointer;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.history-row:hover,
.history-row.is-viewing {
  background: var(--kira-hover);
}

.history-checkbox {
  margin-top: var(--kira-s-1);
  flex-shrink: 0;
}

.history-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

.history-row-line {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.history-time {
  min-width: 64px;
}

.history-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
