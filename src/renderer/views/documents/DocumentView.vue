<script setup lang="ts">
import type { DocumentTabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
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

// P16 design system LAW: the connection colour reaches a view as a 2px rail (here: the
// toolbar cap and the view-head dot) — never a tint or a full border on the panel itself.
// No colour assigned leaves the rail slot unpainted rather than unrendered, so nothing shifts
// when a colour is set later. Mirrors Toolbar.vue's `color`/`railStyle` computed pair.
const connectionColor = computed(() => {
  const id = props.tab.connectionId;
  if (!id) return undefined;
  return connectionsState.records.find((r) => r.id === id)?.color;
});

const railStyle = computed(() => ({
  '--kira-rail': connectionColor.value ? `var(--kira-conn-${connectionColor.value})` : undefined,
}));

const iconColor = computed(() =>
  connectionColor.value ? `var(--kira-conn-${connectionColor.value})` : 'var(--kira-fg-muted)',
);

// The view-head's breadcrumb prefix ("connection / database / "): derived from the already
// loaded connection record and the tab's own path, purely for display — no new state.
const pathPrefix = computed(() => {
  const connectionId = props.tab.connectionId;
  if (!connectionId) return '';
  const connectionName = connectionsState.records.find((r) => r.id === connectionId)?.name;
  const segments = decodePath(connectionId, props.tab.path).segments;
  const parts = [connectionName, ...segments.slice(0, -1).map((s) => s.name)].filter(
    (p): p is string => !!p,
  );
  return parts.length ? `${parts.join(' / ')} / ` : '';
});

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
      <button
        type="button"
        class="p-dlgbtn primary"
        data-testid="document-reconnect-load"
        @click="onReconnectAndLoad"
      >
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <!-- The view header is the same 28px object as a toolbar: it carries identity instead of
           actions, so documents / key-value / stream / DDL all open the same way. -->
      <div class="p-view-head">
        <span class="p-conn-dot" :style="railStyle" title="Connection colour"></span>
        <span class="icon-box" :style="{ color: iconColor }">
          <Codicon name="json" :size="13" />
        </span>
        <span class="p-view-target" data-testid="document-target">
          <span class="path">{{ pathPrefix }}</span>{{ targetTail?.name ?? tab.path }}
        </span>
        <span class="p-badge">collection</span>
      </div>

      <!-- LAW 07 — the connection's colour caps the toolbar, not the panel. With no colour the
           slot is still 2px, so nothing shifts. -->
      <div class="p-toolbar-rail" :style="railStyle"></div>
      <div class="p-toolbar">
        <div class="group">
          <button
            type="button"
            class="p-iconbtn"
            title="Refresh"
            data-testid="document-refresh"
            @click="reload(tab.id)"
          >
            <Codicon name="refresh" :size="13" />
          </button>
          <!-- Stop always follows Refresh, disabled when idle — cancelling lives in one place
               instead of appearing only once work starts. -->
          <button
            type="button"
            class="p-iconbtn"
            data-testid="document-stop"
            :disabled="!running"
            :title="running ? 'Stop' : 'Nothing running'"
            @click="onStop"
          >
            <Codicon name="debug-stop" :size="13" />
          </button>
          <!-- Work-in-progress is this ring, not a bar across the view. -->
          <span
            class="p-run-state"
            :class="{ 'is-running': running, 'is-error': rt?.status === 'error' }"
            :title="statusLine"
          >
            <span class="ring"></span>
          </span>
        </div>
        <div class="sep"></div>
        <div class="group">
          <button
            type="button"
            class="p-iconbtn"
            data-testid="document-prev"
            :disabled="!rt?.prevToken"
            title="Previous page"
            @click="goPrev(tab.id)"
          >
            <Codicon name="arrow-left" :size="13" />
          </button>
          <span class="mono p-sm">{{ rt?.rowCount ?? 0 }} loaded</span>
          <template v-if="rt?.count">
            <span class="p-sm dim">of</span>
            <span class="mono p-sm muted"
              >{{ rt.count.exact ? '' : '≈ ' }}{{ rt.count.value.toLocaleString() }}</span
            >
          </template>
          <button
            type="button"
            class="p-iconbtn"
            data-testid="document-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          >
            <Codicon name="arrow-right" :size="13" />
          </button>
          <button
            type="button"
            class="p-btn"
            data-testid="document-count"
            title="Run an exact countDocuments() — the estimate above is metadata"
            @click="runCount(tab.id)"
          >
            <span class="icon-box"><Codicon name="symbol-number" :size="13" /></span>Exact count
          </button>
        </div>
        <div class="sep"></div>
        <div class="group">
          <button
            type="button"
            class="p-iconbtn"
            title="Expand all"
            data-testid="document-expand-all"
            @click="onExpandAll"
          >
            <Codicon name="expand-all" :size="13" />
          </button>
          <button
            type="button"
            class="p-iconbtn"
            title="Collapse all"
            data-testid="document-collapse-all"
            @click="onCollapseAll"
          >
            <Codicon name="collapse-all" :size="13" />
          </button>
        </div>
      </div>

      <!-- The Mongo dialect of the filter row: one filter box, permanent, never closed. -->
      <div class="p-toolbar last">
        <span class="p-input" style="flex: 1; min-width: 0">
          <input
            v-model="searchText"
            type="text"
            placeholder="Filter (e.g. { name: 'a' })"
            data-testid="document-search"
            @keyup.enter="onSearchInput"
            @blur="onSearchInput"
          />
        </span>
      </div>

      <div v-if="rt?.status === 'error' && rt.error" class="p-strip err" data-testid="document-error">
        {{ rt.error.message }}
      </div>

      <div class="list-body" data-testid="document-list">
        <div v-if="!rt || rt.rowCount === 0" class="p-empty">
          <span v-if="rt" class="label">No documents</span>
        </div>
        <template v-else>
          <div
            v-for="i in rowIndices"
            :key="rowAt(i)?.id ?? i"
            class="doc-row"
            :class="{ open: isExpanded(rowAt(i)?.id ?? '') }"
            data-testid="document-row"
            :data-id="rowAt(i)?.id"
            @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.id, rowAt(i)!.body)"
          >
            <div class="doc-head">
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
              <span class="doc-preview">{{ previewLine(rowAt(i)?.body ?? '') }}</span>
              <div class="doc-row-actions">
                <span v-if="editingId === rowAt(i)?.id" class="p-chip warn">editing</span>
                <button
                  type="button"
                  class="p-iconbtn"
                  :class="{ 'is-active': editingId === rowAt(i)?.id }"
                  data-testid="document-edit"
                  title="Edit"
                  @click="rowAt(i) && startEdit(rowAt(i)!.id, rowAt(i)!.body)"
                >
                  <Codicon name="edit" :size="12" />
                </button>
              </div>
            </div>
            <!-- The editor is the same code surface DDL and the console views use — the only
                 difference is the language. -->
            <div v-if="isExpanded(rowAt(i)?.id ?? '')" class="doc-body" data-testid="document-body">
              <template v-if="editingId === rowAt(i)?.id">
                <CodeMirrorHost v-model:doc="editDraft" language="json" :read-only="false" />
                <div class="edit-actions">
                  <button
                    type="button"
                    class="p-btn primary"
                    data-testid="document-edit-save"
                    @click="commitEdit"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    class="p-btn"
                    data-testid="document-edit-cancel"
                    @click="cancelEdit"
                  >
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
              <span
                v-if="rowAt(i)?.isTruncated"
                class="p-badge truncated-marker"
                title="value truncated"
                >truncated</span
              >
            </div>
          </div>
        </template>
      </div>
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

.list-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.doc-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.doc-head {
  height: var(--kira-h-md);
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4);
  cursor: pointer;
}

.doc-head:hover {
  background: var(--kira-hover);
}

.doc-row.open > .doc-head {
  background: var(--kira-bg-elevated);
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
  padding: 0;
}

.doc-id {
  flex-shrink: 0;
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-md);
  color: var(--kira-fg);
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
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.doc-row-actions {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.doc-body {
  height: 220px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
  display: flex;
  flex-direction: column;
}

.edit-actions {
  flex-shrink: 0;
  display: flex;
  gap: var(--kira-s-3);
  padding: var(--kira-s-2) var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.truncated-marker {
  flex-shrink: 0;
  align-self: flex-start;
  margin: var(--kira-s-2) var(--kira-s-4);
}
</style>
