<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { connColorVar } from '@theme/connColor';
import { formatRelative } from '@workbench/util/format';
import { computed } from 'vue';
import { useConnectionDialogStore, useConnectionsStore } from '../../state/connections';
import { useDatagripImportStore } from '../../state/datagripImport';
import { type RecentTableEntry, useRecentTablesStore, useTabsStore } from '../../state/tabs';

// P1 C4: Studio's two empty states, extracted verbatim out of MainView.vue's old dispatch
// chain (F9) — the mode's own "nothing open" content, mirroring api/ApiStart.vue (C6).

// P16 design system's FirstRun.html: one door, no vestibule. The engine grid lives only in
// the New connection dialog, never repeated at the top level.
const datagripImportStore = useDatagripImportStore();
const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();
const recentTablesStore = useRecentTablesStore();
const tabsStore = useTabsStore();

const hasConnections = computed(() => connectionsStore.records.length > 0);

function connectionFor(entry: RecentTableEntry) {
  return connectionsStore.connectionRecord(entry.connectionId);
}

function iconFor(entry: RecentTableEntry): string {
  if (entry.kind === 'document') return 'json';
  // P17: a 'keyvalue' entry is a redis key OR an s3 object — same pathTail-kind check
  // TabStrip.vue's own iconFor makes for the live tab icon.
  if (entry.kind === 'keyvalue')
    return pathTail(entry.path)?.kind === 'object' ? 'file' : 'symbol-key';
  if (entry.kind === 'stream') return 'broadcast';
  return 'table';
}

function iconColorFor(entry: RecentTableEntry): string {
  if (entry.kind === 'document') {
    return connColorVar(connectionFor(entry)?.color) ?? 'var(--kira-fg-muted)';
  }
  return 'var(--kira-info)';
}

function openRecent(entry: RecentTableEntry): void {
  if (entry.kind === 'data') tabsStore.openDataTab(entry.connectionId, entry.path);
  else if (entry.kind === 'document') tabsStore.openDocumentTab(entry.connectionId, entry.path);
  else if (entry.kind === 'keyvalue') tabsStore.openKeyValueTab(entry.connectionId, entry.path);
  else tabsStore.openStreamTab(entry.connectionId, entry.path);
}
</script>

<template>
  <!-- FirstRun.html — no connections at all: one button, no duplicate engine grid. -->
  <div v-if="!hasConnections" class="start" data-testid="first-run">
    <div class="start-inner first-run">
      <span class="start-mark text-subtle"><CodiconIcon name="database" :size="32" /></span>
      <div class="start-title">No connections yet</div>
      <div class="start-sub text-muted-foreground">
        Kira Studio needs somewhere to connect before it can show you anything.
      </div>
      <span class="first-run-actions">
        <button type="button" class="p-dlgbtn primary" @click="connectionDialogStore.openCreateDialog">
          <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="add" :size="13" /></span>
          New connection
        </button>
        <button
          type="button"
          class="p-dlgbtn"
          data-testid="first-run-import-datagrip"
          @click="datagripImportStore.pickAndScanDataGripProject"
        >
          <span class="size-4 flex items-center justify-center shrink-0"><CodiconIcon name="cloud-download" :size="13" /></span>
          Import from DataGrip
        </button>
      </span>
    </div>
  </div>

  <!-- Empty.html — connections exist, nothing open: recent tables and nothing else. -->
  <div v-else class="start" data-testid="no-tab-open">
    <div class="start-inner">
      <div class="start-title">Kira Studio</div>
      <div class="start-sub text-muted-foreground">Pick something from the tree on the left, or reopen one of these.</div>

      <template v-if="recentTablesStore.entries.length > 0">
        <div class="col-label text-subtle">Recent tables</div>
        <div class="start-list">
          <button
            v-for="entry in recentTablesStore.entries"
            :key="`${entry.kind}:${entry.connectionId}:${entry.path}`"
            type="button"
            class="start-row"
            @click="openRecent(entry)"
          >
            <span
              class="rail-dot"
              :style="{ background: connColorVar(connectionFor(entry)?.color) ?? 'none' }"
            />
            <span class="size-4 flex items-center justify-center shrink-0" :style="{ color: iconColorFor(entry) }">
              <CodiconIcon :name="iconFor(entry)" :size="13" />
            </span>
            <span class="entry-path">{{ entry.path }}</span>
            <span class="ml-auto text-kira-xs text-subtle">{{ connectionFor(entry)?.name ?? '—' }} · {{ formatRelative(entry.openedAt) }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.start {
  @apply flex-1 min-h-0 flex items-center justify-center overflow-auto;
  padding: var(--kira-s-6);
}

.start-inner {
  @apply w-140 max-w-full;
}

.first-run-actions {
  @apply flex;
  gap: var(--kira-s-3);
}

.start-inner.first-run {
  @apply w-96 flex flex-col items-center text-center;
  gap: var(--kira-s-4);
}

.start-title {
  /* P24 D31: no bold text anywhere in the app — --kira-t-xl (the scale's largest step) already
     carries the emphasis a first-run heading needs. */
  @apply tracking-normal;
  font-size: var(--kira-t-xl);
  color: var(--kira-fg);
}

.start-sub {
  font-size: var(--kira-t-lg);
  margin-top: var(--kira-s-3);
}

.first-run .start-sub {
  @apply leading-normal mt-0;
  font-size: var(--kira-t-md);
}

.col-label {
  @apply uppercase tracking-wider;
  font-size: var(--kira-t-sm);
  margin-bottom: var(--kira-s-3);
  margin-top: var(--kira-s-6);
}

.start-list {
  @apply flex flex-col;
}

.start-row {
  @apply w-full flex items-center cursor-pointer text-left rounded-kira-sm;
  height: var(--kira-h-md);
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-3);
  color: var(--kira-fg);
  font-size: var(--kira-t-md);
}

.start-row:hover {
  background: var(--kira-hover);
}

.rail-dot {
  @apply w-0.5 h-3.5 rounded-xs shrink-0;
}

.entry-path {
  @apply overflow-hidden text-ellipsis whitespace-nowrap min-w-0;
}
</style>
