<script setup lang="ts">
import type { DocumentTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import { documentRow, isIdNull, pageVersion } from './docPage';
import { documentMenu } from './documentMenu';
import { saveDocumentEdit } from './documentMutations';
import {
  goNext,
  goPrev,
  load,
  reload,
  runCount,
  runtime,
  setAllExpanded,
  setSearch,
  stop,
  toggleExpanded,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as DdlView.vue/ConsoleView.vue.
const props = defineProps<{ tab: DocumentTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));
const searchText = ref(props.tab.state.search);

function onSearchInput(): void {
  setSearch(props.tab.id, searchText.value);
}

const rowIndices = computed(() => {
  void pageVersion.n;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

const allIds = computed(() => {
  void pageVersion.n;
  return rowIndices.value
    .map((i) => documentRow(props.tab.id, i)?.id)
    .filter((id): id is string => id !== undefined);
});

function rowAt(i: number) {
  void pageVersion.n;
  return documentRow(props.tab.id, i);
}

function isExpanded(id: string): boolean {
  return !!props.tab.state.expanded[id];
}

// One preview line: the body's own text, collapsed to a single line — expanding shows the full
// EJSON via the read-only CodeMirror host below (§8.7's "truncation with a show-all affordance"
// maps onto that same expand action for a document already loaded in the page).
function previewLine(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim();
  return oneLine.length > 200 ? `${oneLine.slice(0, 200)}…` : oneLine;
}

const editingId = ref<string | null>(null);
const editDraft = ref('');

function startEdit(id: string, body: string): void {
  editingId.value = id;
  editDraft.value = body;
}

function cancelEdit(): void {
  editingId.value = null;
  editDraft.value = '';
}

async function commitEdit(): Promise<void> {
  const id = editingId.value;
  if (id === null) return;
  await saveDocumentEdit(props.tab.id, id, editDraft.value);
  editingId.value = null;
  editDraft.value = '';
}

function onRowContextMenu(e: MouseEvent, id: string, body: string): void {
  e.preventDefault();
  openContextMenu(
    e,
    documentMenu(props.tab.id, id, body, allIds.value, () => startEdit(id, body)),
  );
}

function onStop(): void {
  stop(props.tab.id);
}

function onExpandAll(): void {
  setAllExpanded(props.tab.id, allIds.value, true);
}

function onCollapseAll(): void {
  setAllExpanded(props.tab.id, allIds.value, false);
}

const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  const parts: string[] = [];
  parts.push(`${r.rowCount} document${r.rowCount === 1 ? '' : 's'} on this page`);
  if (r.count) {
    parts.push(`${r.count.exact ? '' : '~'}${r.count.value.toLocaleString()} total`);
  }
  return parts.join(' · ');
});

let unregisterCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
});

onUnmounted(() => {
  unregisterCommand?.();
});
</script>

<template>
  <div class="document-view" data-testid="document-view" :data-path="tab.path">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="document-reconnect">
      <button type="button" data-testid="document-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <div class="header">
        <span class="target" data-testid="document-target">{{ targetTail?.name ?? tab.path }}</span>
        <div class="toolbar">
          <input
            v-model="searchText"
            type="text"
            class="search-box"
            placeholder="Filter (e.g. { name: 'a' })"
            data-testid="document-search"
            @keyup.enter="onSearchInput"
            @blur="onSearchInput"
          />
          <button type="button" data-testid="document-refresh" title="Refresh" @click="reload(tab.id)">
            <Codicon name="refresh" :size="13" />
          </button>
          <button type="button" data-testid="document-expand-all" title="Expand all" @click="onExpandAll">
            <Codicon name="expand-all" :size="13" />
          </button>
          <button
            type="button"
            data-testid="document-collapse-all"
            title="Collapse all"
            @click="onCollapseAll"
          >
            <Codicon name="collapse-all" :size="13" />
          </button>
          <button type="button" data-testid="document-count" title="Exact count" @click="runCount(tab.id)">
            <Codicon name="symbol-number" :size="13" />
          </button>
          <button
            type="button"
            data-testid="document-prev"
            :disabled="!rt?.prevToken"
            title="Previous page"
            @click="goPrev(tab.id)"
          >
            <Codicon name="arrow-left" :size="13" />
          </button>
          <button
            type="button"
            data-testid="document-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          >
            <Codicon name="arrow-right" :size="13" />
          </button>
          <button v-if="running" type="button" data-testid="document-stop" title="Stop" @click="onStop">
            <Codicon name="debug-stop" :size="13" />
          </button>
        </div>
      </div>

      <div v-if="rt?.status === 'loading'" class="loading-bar" data-testid="document-loading" />
      <div v-if="rt?.status === 'error' && rt.error" class="error-strip" data-testid="document-error">
        {{ rt.error.message }}
      </div>

      <div class="list-body" data-testid="document-list">
        <div v-if="!rt || rt.rowCount === 0" class="no-rows">{{ rt ? 'No documents' : '' }}</div>
        <template v-else>
          <div
            v-for="i in rowIndices"
            :key="rowAt(i)?.id ?? i"
            class="doc-row"
            data-testid="document-row"
            :data-id="rowAt(i)?.id"
            @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.id, rowAt(i)!.body)"
          >
            <div class="doc-row-header">
              <button
                type="button"
                class="expand-toggle"
                data-testid="document-toggle-expand"
                :aria-label="isExpanded(rowAt(i)?.id ?? '') ? 'Collapse' : 'Expand'"
                @click="rowAt(i) && toggleExpanded(tab.id, rowAt(i)!.id)"
              >
                <Codicon
                  :name="isExpanded(rowAt(i)?.id ?? '') ? 'chevron-down' : 'chevron-right'"
                  :size="13"
                />
              </button>
              <span class="doc-id" data-testid="document-id">{{ rowAt(i)?.id }}</span>
              <span v-if="!isExpanded(rowAt(i)?.id ?? '')" class="doc-preview">{{
                previewLine(rowAt(i)?.body ?? '')
              }}</span>
              <div class="doc-row-actions">
                <button
                  type="button"
                  data-testid="document-edit"
                  title="Edit"
                  @click="rowAt(i) && startEdit(rowAt(i)!.id, rowAt(i)!.body)"
                >
                  <Codicon name="edit" :size="12" />
                </button>
              </div>
            </div>
            <div v-if="isExpanded(rowAt(i)?.id ?? '')" class="doc-body" data-testid="document-body">
              <template v-if="editingId === rowAt(i)?.id">
                <CodeMirrorHost v-model:doc="editDraft" language="json" :read-only="false" />
                <div class="edit-actions">
                  <button type="button" data-testid="document-edit-save" @click="commitEdit">Save</button>
                  <button type="button" data-testid="document-edit-cancel" @click="cancelEdit">
                    Cancel
                  </button>
                </div>
              </template>
              <CodeMirrorHost
                v-else
                :doc="rowAt(i)?.body ?? ''"
                language="json"
                :read-only="true"
              />
              <span v-if="rowAt(i)?.isTruncated" class="truncated-marker" title="value truncated"
                >(truncated)</span
              >
            </div>
          </div>
        </template>
      </div>

      <div class="status-line" data-testid="document-status">{{ statusLine }}</div>
    </template>
  </div>
</template>

<style scoped>
.document-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.reconnect-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reconnect-panel button {
  padding: 6px 14px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.reconnect-panel button:hover {
  background: var(--kira-hover);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 11px;
  flex-shrink: 0;
  overflow: hidden;
}

.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg);
  font-weight: 600;
  min-width: 0;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.search-box {
  width: 220px;
  padding: 3px 6px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 11px;
  font-family: var(--kira-font-family);
}

.toolbar button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.toolbar button:disabled {
  opacity: 0.5;
  cursor: default;
}

.loading-bar {
  height: 2px;
  flex-shrink: 0;
  background: linear-gradient(90deg, transparent, var(--kira-accent), transparent);
  background-size: 200% 100%;
  animation: loading-sweep 1.2s linear infinite;
}

@keyframes loading-sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.error-strip {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--kira-font-family);
  color: var(--kira-error);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  white-space: pre-wrap;
}

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.no-rows {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kira-fg-muted);
  font-size: 12px;
}

.doc-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-row-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  min-height: 28px;
}

.expand-toggle {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px;
}

.doc-id {
  flex-shrink: 0;
  font-family: var(--kira-font-family);
  font-size: 11px;
  color: var(--kira-fg-muted);
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-preview {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--kira-font-family);
  font-size: 11px;
  color: var(--kira-fg);
}

.doc-row-actions {
  flex-shrink: 0;
  display: flex;
  gap: 2px;
}

.doc-row-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px;
}

.doc-row-actions button:hover {
  color: var(--kira-fg);
}

.doc-body {
  height: 220px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  display: flex;
  flex-direction: column;
}

.edit-actions {
  flex-shrink: 0;
  display: flex;
  gap: 6px;
  padding: 4px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.edit-actions button {
  padding: 3px 10px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 11px;
}

.truncated-marker {
  flex-shrink: 0;
  padding: 2px 8px;
  font-size: 10px;
  color: var(--kira-fg-muted);
}

.status-line {
  flex-shrink: 0;
  padding: 3px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
