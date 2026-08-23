<script setup lang="ts">
import type { OpRecord } from '@shared/domain/ops';
import { splitSqlStatements } from '@shared/domain/sql-split';
import { tabTitle } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { control } from '../../bridge/control';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectionsState } from '../../state/connections';
import { clearOps, opsState, runningCount, visibleOps } from '../../state/ops';
import { activateTab, openConsoleTab, tabsState } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { connColorVar } from '../../theme/connColor';
import Segmented from '../../theme/primitives/Segmented.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { run as runConsole } from '../../views/console/state';
import { type MenuItem, openContextMenu } from '../state/contextMenu';
import VirtualList from '../VirtualList.vue';
import EmptyState from './EmptyState.vue';

interface OpsListItem {
  key: string;
  kind: 'op' | 'detail-command' | 'detail-error';
  record: OpRecord;
}

const expandedId = ref<string | null>(null);

const statusFilterOptions = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'error', label: 'Errors' },
] as const;

function toggleExpanded(record: OpRecord): void {
  expandedId.value = expandedId.value === record.id ? null : record.id;
}

const listItems = computed<OpsListItem[]>(() => {
  const out: OpsListItem[] = [];
  for (const record of visibleOps.value) {
    out.push({ key: record.id, kind: 'op', record });
    if (expandedId.value === record.id) {
      if (record.command) out.push({ key: `${record.id}-cmd`, kind: 'detail-command', record });
      if (record.error) out.push({ key: `${record.id}-err`, kind: 'detail-error', record });
    }
  }
  return out;
});

function connectionFor(record: OpRecord) {
  return record.connectionId
    ? connectionsState.records.find((r) => r.id === record.connectionId)
    : undefined;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

async function onCancel(record: OpRecord): Promise<void> {
  await control.opsCancel(record.id);
}

function tabTitleFor(record: OpRecord): string {
  const tab = record.tabId ? tabsState.tabs.find((t) => t.id === record.tabId) : undefined;
  return tab ? tabTitle(tab) : '—';
}

// §8.11: "Clicking a row reveals the tab that issued it" — a no-op when the tab has since
// been closed, never an error.
function revealTab(record: OpRecord): void {
  if (record.tabId && tabsState.tabs.some((t) => t.id === record.tabId)) {
    activateTab(record.tabId);
  }
}

function onRowClick(record: OpRecord): void {
  toggleExpanded(record);
  revealTab(record);
}

function sqlDialectFor(record: OpRecord): 'postgres' | 'mariadb' | undefined {
  const kind = connectionFor(record)?.kind;
  return kind === 'postgres' || kind === 'mariadb' ? kind : undefined;
}

// D10: Re-run reopens the exact command text through a fresh console tab and runs it
// immediately — the one execution path built for arbitrary, operator-supervised statement
// replay, rather than blindly re-invoking whatever op kind (read/count/mutate/execute)
// produced the row.
function onRerun(record: OpRecord): void {
  if (!record.connectionId || !record.command) return;
  const statements = splitSqlStatements(record.command).map((s) => s.text);
  if (statements.length === 0) return;
  const tabId = openConsoleTab(record.connectionId, '');
  void runConsole(tabId, statements);
}

function onRowContextMenu(record: OpRecord, event: MouseEvent): void {
  const hasTab = record.tabId !== null && tabsState.tabs.some((t) => t.id === record.tabId);
  const canSql = !!record.connectionId && connectionsState.states[record.connectionId]?.caps?.sql;
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'reveal-tab',
      label: 'Reveal originating tab',
      disabled: !hasTab,
      run: () => revealTab(record),
    },
    {
      type: 'item',
      id: 'copy-command',
      label: 'Copy command',
      icon: 'copy',
      disabled: !record.command,
      run: () => copyText(record.command ?? ''),
    },
    {
      type: 'item',
      id: 'copy-error',
      label: 'Copy error',
      icon: 'copy',
      disabled: !record.error,
      run: () => copyText(record.error ?? ''),
    },
    {
      type: 'item',
      id: 're-run',
      label: 'Re-run',
      icon: 'play',
      disabled: !record.command || !canSql,
      run: () => onRerun(record),
    },
    {
      type: 'item',
      id: 'cancel',
      label: 'Cancel',
      icon: 'debug-stop',
      disabled: record.status !== 'running',
      run: () => onCancel(record),
    },
  ];
  openContextMenu(event, items);
}
</script>

<template>
  <div class="ops-panel">
    <div class="ops-header">
      <div class="filter-input">
        <TextField
          v-model="opsState.filterText"
          icon="filter"
          placeholder="Filter"
          data-testid="ops-filter"
        />
      </div>
      <Segmented v-model="opsState.statusFilter" :options="statusFilterOptions" />
      <span class="running-count">{{ runningCount }} running</span>
      <button
        type="button"
        class="clear-button"
        title="Clears the in-memory ring only — op_log retention is automatic"
        @click="clearOps"
      >
        Clear
      </button>
    </div>

    <div v-if="visibleOps.length === 0" class="min-h-0 flex-1">
      <EmptyState icon="checklist" label="No operations yet" />
    </div>
    <template v-else>
      <div class="ops-columns">
        <span>Time</span>
        <span>Connection</span>
        <span>Tab</span>
        <span>Kind</span>
        <span>Status</span>
        <span>Duration</span>
        <span>Rows</span>
        <span>Command</span>
      </div>
      <div class="ops-body">
        <!--
          The expanded command/error detail rows embed a CodeMirrorHost (D18/D19) inside
          VirtualList's fixed 20px row rather than making VirtualList itself variable-height
          (P2 §0 note 14 leaves it fixed on purpose) — scoped CSS below forces a single
          non-wrapping line and hides the line-number gutter so it reads like the plain text
          it replaces, just with SQL syntax highlighting.
        -->
        <VirtualList :items="listItems" :row-height="20">
          <template #default="{ item }">
            <div
              v-if="item.kind === 'op'"
              class="ops-row"
              :class="{ error: item.record.status === 'error' }"
              data-testid="op-row"
              :data-status="item.record.status"
              @click="onRowClick(item.record)"
              @contextmenu.prevent="onRowContextMenu(item.record, $event)"
            >
              <span class="mono">{{ formatTime(item.record.startedAt) }}</span>
              <span class="connection-cell">
                <span
                  v-if="connectionFor(item.record)"
                  class="chip"
                  :style="{ background: connColorVar(connectionFor(item.record)?.color) ?? 'none' }"
                />
                <span class="truncate">{{ connectionFor(item.record)?.name ?? '—' }}</span>
              </span>
              <span class="truncate" data-testid="op-tab-cell">{{ tabTitleFor(item.record) }}</span>
              <span>{{ item.record.kind }}</span>
              <span class="status-cell">
                <Codicon v-if="item.record.status === 'running'" name="loading" class="spin" :size="12" />
                {{ item.record.status }}
                <button
                  v-if="item.record.status === 'running'"
                  type="button"
                  class="cancel-button"
                  aria-label="Cancel operation"
                  @click.stop="onCancel(item.record)"
                >
                  <Codicon name="debug-stop" :size="12" />
                </button>
              </span>
              <span>{{ formatDuration(item.record.durationMs) }}</span>
              <span>{{ item.record.rows ?? '—' }}</span>
              <span v-if="item.record.status === 'error'" class="mono truncate error-text" :title="item.record.error ?? ''">
                {{ item.record.error }}
              </span>
              <span v-else class="mono truncate" :title="item.record.command ?? ''">{{ item.record.command ?? '—' }}</span>
            </div>
            <div v-else-if="item.kind === 'detail-command'" class="ops-detail-row ops-detail-cm">
              <CodeMirrorHost
                :doc="`command: ${item.record.command}`"
                language="sql"
                :sql-dialect="sqlDialectFor(item.record)"
                :read-only="true"
              />
            </div>
            <div v-else class="ops-detail-row ops-detail-cm">
              <CodeMirrorHost :doc="`error: ${item.record.error}`" language="plain" :read-only="true" />
            </div>
          </template>
        </VirtualList>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ops-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  font-size: 11px;
}

.ops-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed-width sizing moves onto this wrapper
   instead of a style/class attribute on the component tag itself (DocumentView.vue precedent). */
.filter-input {
  flex: 0 0 160px;
}

.filter-input :deep(.p-input) {
  width: 100%;
}

.running-count {
  color: var(--kira-fg-muted);
  margin-left: auto;
}

.clear-button {
  background: transparent;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px 8px;
  font-size: 11px;
}

.ops-columns,
.ops-row,
.ops-detail-row {
  display: grid;
  grid-template-columns: 90px 140px 40px 80px 90px 70px 60px 1fr;
  gap: 8px;
  padding: 0 8px;
  align-items: center;
}

.ops-columns {
  flex-shrink: 0;
  height: 20px;
  color: var(--kira-fg-muted);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-weight: 600;
}

.ops-body {
  flex: 1;
  min-height: 0;
}

.ops-row {
  height: 20px;
  cursor: pointer;
  user-select: text;
}

.ops-row:hover {
  background: var(--kira-hover);
}

.ops-row.error {
  color: var(--kira-error);
}

.connection-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.chip {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-radius: 2px;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.mono {
  font-family: var(--kira-font-family);
}

.error-text {
  color: var(--kira-error);
}

.status-cell {
  display: flex;
  align-items: center;
  gap: 4px;
}

.spin {
  animation: ops-spin 1s linear infinite;
}

@keyframes ops-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.cancel-button {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0;
  display: flex;
}

.ops-detail-row {
  height: 20px;
  grid-template-columns: 1fr;
  color: var(--kira-fg-muted);
  background: var(--kira-bg-elevated);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ops-detail-cm {
  padding: 0;
}

.ops-detail-cm :deep(.cm-editor) {
  height: 20px;
  font-size: 11px;
}

.ops-detail-cm :deep(.cm-scroller) {
  overflow: hidden;
}

.ops-detail-cm :deep(.cm-content) {
  white-space: pre;
  padding: 0;
}

.ops-detail-cm :deep(.cm-line) {
  padding: 0 8px;
}

.ops-detail-cm :deep(.cm-gutters) {
  display: none;
}
</style>
