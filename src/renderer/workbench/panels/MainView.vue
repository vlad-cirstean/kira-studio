<script setup lang="ts">
import { pathTail } from '@shared/domain/tree';
import { computed } from 'vue';
import { connectionsState, openCreateDialog } from '../../state/connections';
import {
  activeTab,
  openDataTab,
  openDocumentTab,
  openKeyValueTab,
  openStreamTab,
  type RecentTableEntry,
  recentTablesState,
} from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import ConsoleTabView from '../../views/console/ConsoleView.vue';
import DefinitionTabView from '../../views/definition/DefinitionView.vue';
import DocumentTabView from '../../views/documents/DocumentView.vue';
import DataTabView from '../../views/grid/DataView.vue';
import KeyValueTabView from '../../views/keyvalue/KeyValueView.vue';
import StreamTabView from '../../views/stream/StreamView.vue';

// P16 design system's FirstRun.html: one door, no vestibule. The engine grid lives only in
// the New connection dialog, never repeated at the top level.
const hasConnections = computed(() => connectionsState.records.length > 0);

function connectionFor(entry: RecentTableEntry) {
  return connectionsState.records.find((r) => r.id === entry.connectionId);
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

function formatRelative(openedAt: number): string {
  const minutes = Math.floor((Date.now() - openedAt) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} d ago`;
}

function openRecent(entry: RecentTableEntry): void {
  if (entry.kind === 'data') openDataTab(entry.connectionId, entry.path);
  else if (entry.kind === 'document') openDocumentTab(entry.connectionId, entry.path);
  else if (entry.kind === 'keyvalue') openKeyValueTab(entry.connectionId, entry.path);
  else openStreamTab(entry.connectionId, entry.path);
}
</script>

<template>
  <DataTabView v-if="activeTab && activeTab.kind === 'data'" :key="activeTab.id" :tab="activeTab" />
  <DefinitionTabView
    v-else-if="activeTab && activeTab.kind === 'definition'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <ConsoleTabView
    v-else-if="activeTab && activeTab.kind === 'console'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <DocumentTabView
    v-else-if="activeTab && activeTab.kind === 'document'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <KeyValueTabView
    v-else-if="activeTab && activeTab.kind === 'keyvalue'"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <StreamTabView
    v-else-if="activeTab && activeTab.kind === 'stream'"
    :key="activeTab.id"
    :tab="activeTab"
  />

  <!-- FirstRun.html — no connections at all: one button, no duplicate engine grid. -->
  <div v-else-if="!hasConnections" class="start" data-testid="first-run">
    <div class="start-inner first-run">
      <span class="start-mark dim"><CodiconIcon name="database" :size="32" /></span>
      <div class="start-title">No connections yet</div>
      <div class="start-sub muted">
        Kira Studio needs somewhere to connect before it can show you anything.
      </div>
      <button type="button" class="p-dlgbtn primary" @click="openCreateDialog">
        <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
        New connection
      </button>
    </div>
  </div>

  <!-- Empty.html — connections exist, nothing open: recent tables and nothing else. -->
  <div v-else class="start" data-testid="no-tab-open">
    <div class="start-inner">
      <div class="start-title">Kira Studio</div>
      <div class="start-sub muted">Pick something from the tree on the left, or reopen one of these.</div>

      <template v-if="recentTablesState.entries.length > 0">
        <div class="col-label dim">Recent tables</div>
        <div class="start-list">
          <button
            v-for="entry in recentTablesState.entries"
            :key="`${entry.kind}:${entry.connectionId}:${entry.path}`"
            type="button"
            class="start-row"
            @click="openRecent(entry)"
          >
            <span
              class="rail-dot"
              :style="{ background: connColorVar(connectionFor(entry)?.color) ?? 'none' }"
            />
            <span class="icon-box" :style="{ color: iconColorFor(entry) }">
              <CodiconIcon :name="iconFor(entry)" :size="13" />
            </span>
            <span class="entry-path">{{ entry.path }}</span>
            <span class="p-push p-xs dim">{{ connectionFor(entry)?.name ?? '—' }} · {{ formatRelative(entry.openedAt) }}</span>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.start {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kira-s-6);
  overflow: auto;
}

.start-inner {
  width: 560px;
  max-width: 100%;
}

.start-inner.first-run {
  width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--kira-s-4);
}

.start-title {
  /* P24 D31: no bold text anywhere in the app — --kira-t-xl (the scale's largest step) already
     carries the emphasis a first-run heading needs. */
  font-size: var(--kira-t-xl);
  color: var(--kira-fg);
  letter-spacing: -0.01em;
}

.start-sub {
  font-size: var(--kira-t-lg);
  margin-top: var(--kira-s-3);
}

.first-run .start-sub {
  font-size: var(--kira-t-md);
  line-height: 1.5;
  margin-top: 0;
}

.col-label {
  font-size: var(--kira-t-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: var(--kira-s-3);
  margin-top: var(--kira-s-6);
}

.start-list {
  display: flex;
  flex-direction: column;
}

.start-row {
  height: var(--kira-h-md);
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-3);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  font-size: var(--kira-t-md);
  cursor: pointer;
  text-align: left;
}

.start-row:hover {
  background: var(--kira-hover);
}

.rail-dot {
  width: 2px;
  height: 13px;
  border-radius: 1px;
  flex-shrink: 0;
}

.entry-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
