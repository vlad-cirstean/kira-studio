<script setup lang="ts">
import type { OpRecord } from '@shared/domain/ops';
import { splitSqlStatements } from '@shared/domain/sql-split';
import { tabTitle } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { control } from '../../bridge/control';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectionsState } from '../../state/connections';
import { type MenuItem, openContextMenu } from '../../state/contextMenu';
import { clearOps, opsState, runningCount, visibleOps } from '../../state/ops';
import { activateTab, openConsoleTab, tabsState } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { connColorVar } from '../../theme/connColor';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import { run as runConsole } from '../../views/console/state';
import { sqlDialectFor } from '../../views/shared/sqlIdent';

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

// Reveal is right-click-only (the row's context menu) — a no-op when the tab has since been
// closed, never an error. A plain click just expands the row's command/error detail; it used to
// also jump to the originating tab, which surprised anyone just trying to read a log entry.
function revealTab(record: OpRecord): void {
  if (record.tabId && tabsState.tabs.some((t) => t.id === record.tabId)) {
    activateTab(record.tabId);
  }
}

function onRowClick(record: OpRecord): void {
  toggleExpanded(record);
}

function opSqlDialect(record: OpRecord) {
  return sqlDialectFor(connectionFor(record)?.kind);
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
      <SegmentedControl v-model="opsState.statusFilter" :options="statusFilterOptions" />
      <span class="running-count">{{ runningCount }} running</span>
      <AppButton
        v-tooltip="'Clears the in-memory ring only — op_log retention is automatic'"
        @click="clearOps"
      >
        Clear
      </AppButton>
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
          VirtualList's fixed row rather than making VirtualList itself variable-height
          (P2 §0 note 14 leaves it fixed on purpose) — scoped CSS below forces a single
          non-wrapping line and hides the line-number gutter so it reads like the plain text
          it replaces, just with SQL syntax highlighting. This prop is JS, not CSS (P24 D34) — it
          has to stay numerically equal to --kira-h-xs (18px), which .ops-row/.ops-columns/
          .ops-detail-row and the embedded .cm-editor's own height all use below.
        -->
        <VirtualList :items="listItems" :row-height="18">
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
                <CodiconIcon v-if="item.record.status === 'running'" name="loading" class="spin" :size="13" />
                {{ item.record.status }}
                <button
                  v-if="item.record.status === 'running'"
                  type="button"
                  class="cancel-button"
                  aria-label="Cancel operation"
                  @click.stop="onCancel(item.record)"
                >
                  <CodiconIcon name="debug-stop" :size="13" />
                </button>
              </span>
              <span>{{ formatDuration(item.record.durationMs) }}</span>
              <span>{{ item.record.rows ?? '—' }}</span>
              <span v-if="item.record.status === 'error'" class="mono truncate error-text" v-tooltip="item.record.error ?? ''">
                {{ item.record.error }}
              </span>
              <span v-else class="mono truncate" v-tooltip="item.record.command ?? ''">{{ item.record.command ?? '—' }}</span>
            </div>
            <div v-else-if="item.kind === 'detail-command'" class="ops-detail-row ops-detail-cm">
              <CodeMirrorHost
                :doc="`command: ${item.record.command}`"
                language="sql"
                :sql-dialect="opSqlDialect(item.record)"
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
  font-size: var(--kira-t-sm);
}

.ops-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-4);
  padding: var(--kira-s-2) var(--kira-s-4);
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

.ops-columns,
.ops-row,
.ops-detail-row {
  display: grid;
  grid-template-columns: 90px 140px 40px 80px 90px 70px 60px 1fr;
  gap: var(--kira-s-4);
  padding: 0 var(--kira-s-4);
  align-items: center;
}

.ops-columns {
  flex-shrink: 0;
  height: var(--kira-h-xs);
  color: var(--kira-fg-muted);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  /* P24 D31: no bold text anywhere in the app — the design system builds hierarchy from colour,
     size, case and letter-spacing alone, matching .p-panel-head's own section-label idiom. */
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.ops-body {
  flex: 1;
  min-height: 0;
}

.ops-row {
  height: var(--kira-h-xs);
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
  gap: var(--kira-s-2);
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
  gap: var(--kira-s-2);
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
  height: var(--kira-h-xs);
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
  height: var(--kira-h-xs);
  font-size: var(--kira-t-sm);
}

/* The detail row is a single fixed-height (20px) line — VirtualList (P2 §0 note 14) has no
   notion of a variable-height row — so a long command can't wrap into view. Horizontal scroll
   (trackpad/shift-wheel/drag, same as the tab strip) is what actually lets you read all of it,
   rather than clipping it exactly like the collapsed row it replaces. */
.ops-detail-cm :deep(.cm-scroller) {
  overflow-x: auto;
  overflow-y: hidden;
}

.ops-detail-cm :deep(.cm-content) {
  white-space: pre;
  padding: 0;
}

.ops-detail-cm :deep(.cm-line) {
  padding: 0 var(--kira-s-4);
}

.ops-detail-cm :deep(.cm-gutters) {
  display: none;
}
</style>
