<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { findStreamTab } from '../../state/tabs';
import SavedListMenu from '../shared/SavedListMenu.vue';
import {
  deleteStreamFilterHistoryEntry,
  listStreamFilterHistory,
  type StreamFilterHistoryEntry,
  toggleStreamFilterHistoryPin,
} from './streamFilterHistory';

// A lean sibling of grid/FilterHistoryMenu.vue/console/ConsoleSavedMenu.vue: this one has no
// "Recent" section at all (SavedListMenu's `recent` prop is optional exactly so a caller can omit
// it) because there is only one list here — session-only history, no separately-persisted saved
// filters to distinguish it from (streamFilterHistory.ts's own doc comment explains why there's no
// SQLite table backing a "saved" tier the way the SQL grid has one).
const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{
  apply: [offset: string | null, partitions: number[], timestamp: string | null];
  close: [];
}>();

function target(): { connectionId: string; path: string } | null {
  const tab = findStreamTab(props.tabId);
  return tab?.connectionId ? { connectionId: tab.connectionId, path: tab.path } : null;
}

const entries = ref<StreamFilterHistoryEntry[]>([]);

function reload(): void {
  const t = target();
  entries.value = t ? listStreamFilterHistory(t.connectionId, t.path) : [];
}
onMounted(reload);

// SavedListMenu is keyed generically off whatever `Entry` its caller passes — here that's just
// StreamFilterHistoryEntry, no union with a second shape (unlike FilterHistoryMenu.vue's saved +
// recent split).
const savedEntries = computed<StreamFilterHistoryEntry[]>(() => entries.value);

function summarize(entry: StreamFilterHistoryEntry): string {
  const parts: string[] = [];
  if (entry.offset !== null) parts.push(`offset ${entry.offset}`);
  if (entry.partitions.length === 1) parts.push(`partition ${entry.partitions[0]}`);
  else if (entry.partitions.length > 1) parts.push(`partitions ${entry.partitions.join(', ')}`);
  if (entry.timestamp !== null) parts.push(`ts ${entry.timestamp}`);
  return parts.length > 0 ? parts.join(' · ') : '(empty filter)';
}

function apply(entry: StreamFilterHistoryEntry): void {
  emit('apply', entry.offset, entry.partitions, entry.timestamp);
  emit('close');
}

function togglePin(entry: StreamFilterHistoryEntry): void {
  const t = target();
  if (!t) return;
  toggleStreamFilterHistoryPin(t.connectionId, t.path, entry.id);
  reload();
}

function remove(entry: StreamFilterHistoryEntry): void {
  const t = target();
  if (!t) return;
  deleteStreamFilterHistoryEntry(t.connectionId, t.path, entry.id);
  reload();
}
</script>

<template>
  <SavedListMenu
    title="Filter history"
    :saved="savedEntries"
    panel-test-id="stream-filter-history"
    backdrop-test-id="stream-filter-history-backdrop"
    saved-entry-test-id="stream-filter-history-entry"
    empty-saved-text="No filter history yet"
    @apply="apply"
    @toggle-pin="togglePin"
    @delete="remove"
    @close="emit('close')"
  >
    <template #entry="{ entry }">
      <span class="entry-name mono">{{ summarize(entry) }}</span>
    </template>
  </SavedListMenu>
</template>
