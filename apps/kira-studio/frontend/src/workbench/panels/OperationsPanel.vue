<script setup lang="ts">
import type { OpRecord } from '@shared/domain/ops';
import { splitSqlStatements } from '@shared/domain/sql-split';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { connColorVar } from '@theme/connColor';
import AppButton from '@theme/primitives/AppButton.vue';
import EmptyState from '@theme/primitives/EmptyState.vue';
import SegmentedControl from '@theme/primitives/SegmentedControl.vue';
import TextField from '@theme/primitives/TextField.vue';
import VirtualList from '@theme/primitives/VirtualList.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { computed, ref } from 'vue';
import { control } from '../../bridge/control';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useOpsStore } from '../../state/ops';
import { TAB_KINDS } from '../../state/tabKinds';
import { useTabsStore } from '../../state/tabs';
import { useConsoleViewStore } from '../../views/console/state';
import { backslashEscapesFor, dollarQuotingFor, sqlDialectFor } from '../../views/shared/sqlIdent';

const contextMenuStore = useContextMenuStore();
const opsStore = useOpsStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const consoleViewStore = useConsoleViewStore();

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
  for (const record of opsStore.visibleOps) {
    out.push({ key: record.id, kind: 'op', record });
    if (expandedId.value === record.id) {
      if (record.command) out.push({ key: `${record.id}-cmd`, kind: 'detail-command', record });
      if (record.error) out.push({ key: `${record.id}-err`, kind: 'detail-error', record });
    }
  }
  return out;
});

function connectionFor(record: OpRecord) {
  return connectionsStore.connectionRecord(record.connectionId);
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

// P2 D14/F7: TAB_KINDS[...].title — the registry P1 D4 made the per-kind source of truth —
// instead of tabs.ts's own tabTitle, which falls back to the raw path (F4) and would print an
// HTTP request tab's opaque constant 'request' path here.
function tabTitleFor(record: OpRecord): string {
  const tab = record.tabId ? tabsStore.tabs.find((t) => t.id === record.tabId) : undefined;
  return tab ? TAB_KINDS[tab.kind].title(tab) : '—';
}

// Reveal is right-click-only (the row's context menu) — a no-op when the tab has since been
// closed, never an error. A plain click just expands the row's command/error detail; it used to
// also jump to the originating tab, which surprised anyone just trying to read a log entry.
function revealTab(record: OpRecord): void {
  if (record.tabId && tabsStore.tabs.some((t) => t.id === record.tabId)) {
    tabsStore.activateTab(record.tabId);
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
// produced the row. P23 D1(c): commandTruncated means record.command is only a 64 KiB prefix of
// what actually ran, so re-running it would silently execute part of a script as though it were
// the whole thing — refused here too, not only via the disabled context-menu item below.
function onRerun(record: OpRecord): void {
  if (!record.connectionId || !record.command || record.commandTruncated) return;
  const statements = splitSqlStatements(record.command, {
    backslashEscapes: backslashEscapesFor(opSqlDialect(record)),
    dollarQuoting: dollarQuotingFor(opSqlDialect(record)),
  }).map((s) => s.text);
  if (statements.length === 0) return;
  const tabId = tabsStore.openConsoleTab(record.connectionId, '');
  void consoleViewStore.run(tabId, statements);
}

function onRowContextMenu(record: OpRecord, event: MouseEvent): void {
  const hasTab = record.tabId !== null && tabsStore.tabs.some((t) => t.id === record.tabId);
  const canSql = !!record.connectionId && connectionsStore.states[record.connectionId]?.caps?.sql;
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
      // P23 D1(c): a truncated command is only a 64 KiB prefix of what actually ran — Copy
      // command stays enabled (copying a prefix is honest and useful), but Re-run must not.
      disabled: !record.command || !canSql || record.commandTruncated,
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
  contextMenuStore.openContextMenu(event, items);
}
</script>

<template>
  <div class="ops-panel">
    <div class="ops-header">
      <div class="filter-input">
        <TextField
          v-model="opsStore.filterText"
          icon="filter"
          placeholder="Filter"
          data-testid="ops-filter"
        />
      </div>
      <SegmentedControl v-model="opsStore.statusFilter" :options="statusFilterOptions" />
      <span class="running-count">{{ opsStore.runningCount }} running</span>
      <AppButton
        v-tooltip="'Clears the in-memory ring only — op_log retention is automatic'"
        @click="opsStore.clearOps"
      >
        Clear
      </AppButton>
    </div>

    <div v-if="opsStore.visibleOps.length === 0" class="min-h-0 flex-1">
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
          The expanded command/error detail rows embed a MonacoHost (D18/D19, P60a) inside
          VirtualList's fixed row rather than making VirtualList itself variable-height
          (P2 §0 note 14 leaves it fixed on purpose) — `single-line` forces a non-wrapping line
          and no gutter so it reads like the plain text it replaces, just with SQL syntax
          highlighting. This prop is JS, not CSS (P24 D34) — it has to stay numerically equal to
          --kira-h-xs (18px), which .ops-row/.ops-columns/.ops-detail-row and the embedded
          .monaco-editor's own height all use below.
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
                <CodiconIcon v-if="item.record.status === 'running'" name="loading" class="animate-spin" :size="13" />
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
              <MonacoHost
                :doc="
                  item.record.commandTruncated
                    ? `command (truncated at 64 KiB — cannot Re-run): ${item.record.command}`
                    : `command: ${item.record.command}`
                "
                :language="item.record.kind === 'http' ? 'plain' : 'sql'"
                :sql-dialect="opSqlDialect(item.record)"
                :read-only="true"
                :single-line="true"
              />
            </div>
            <div v-else class="ops-detail-row ops-detail-cm">
              <MonacoHost
                :doc="`error: ${item.record.error}`"
                language="plain"
                :read-only="true"
                :single-line="true"
              />
            </div>
          </template>
        </VirtualList>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.ops-panel {
  @apply h-full flex flex-col min-h-0;
  font-size: var(--kira-t-sm);
}

.ops-header {
  @apply shrink-0 flex items-center;
  gap: var(--kira-s-4);
  padding: var(--kira-s-2) var(--kira-s-4);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* TextField's root <span class="p-input"> only receives fallthrough attrs on its inner <input>
   (see TextField.vue's inheritAttrs:false), so the fixed-width sizing moves onto this wrapper
   instead of a style/class attribute on the component tag itself (DocumentView.vue precedent). */
.filter-input {
  @apply flex-none w-40;
}

.filter-input :deep(.p-input) {
  @apply w-full;
}

.running-count {
  @apply ml-auto;
  color: var(--kira-fg-muted);
}

.ops-columns,
.ops-row,
.ops-detail-row {
  @apply grid grid-cols-[90px_140px_40px_80px_90px_70px_60px_1fr] items-center;
  gap: var(--kira-s-4);
  padding: 0 var(--kira-s-4);
}

.ops-columns {
  /* P24 D31: no bold text anywhere in the app — the design system builds hierarchy from colour,
     size, case and letter-spacing alone, matching .p-panel-head's own section-label idiom. */
  @apply shrink-0 uppercase tracking-[0.05em];
  height: var(--kira-h-xs);
  color: var(--kira-fg-muted);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.ops-body {
  @apply flex-1 min-h-0;
}

.ops-row {
  @apply cursor-pointer select-text;
  height: var(--kira-h-xs);
}

.ops-row:hover {
  background: var(--kira-hover);
}

.ops-row.error {
  color: var(--kira-error);
}

.connection-cell {
  @apply flex items-center min-w-0;
  gap: var(--kira-s-2);
}

.chip {
  @apply w-2 h-2 shrink-0 rounded-[2px];
}

.truncate {
  @apply overflow-hidden text-ellipsis whitespace-nowrap min-w-0;
}

.mono {
  font-family: var(--kira-font-data);
}

.error-text {
  color: var(--kira-error);
}

.status-cell {
  @apply flex items-center;
  gap: var(--kira-s-2);
}

.cancel-button {
  @apply bg-transparent border-none cursor-pointer p-0 flex;
  color: var(--kira-fg-muted);
}

.ops-detail-row {
  @apply grid-cols-[1fr] overflow-hidden text-ellipsis whitespace-nowrap;
  height: var(--kira-h-xs);
  color: var(--kira-fg-muted);
  background: var(--kira-bg-elevated);
}

.ops-detail-cm {
  @apply p-0;
}

.ops-detail-cm :deep(.monaco-editor) {
  height: var(--kira-h-xs);
  font-size: var(--kira-t-sm);
}

/* The detail row is a single fixed-height (20px) line — VirtualList (P2 §0 note 14) has no
   notion of a variable-height row — so a long command can't wrap into view. Horizontal scroll
   (trackpad/shift-wheel/drag, same as the tab strip) is what actually lets you read all of it,
   rather than clipping it exactly like the collapsed row it replaces. `single-line` (above)
   already turns wordWrap off and the gutter off; this only adds the left/right breathing room
   `.cm-line`'s own padding used to give each row. */
.ops-detail-cm :deep(.monaco-scrollable-element) {
  overflow-x: auto;
  overflow-y: hidden;
}

.ops-detail-cm :deep(.view-line) {
  padding: 0 var(--kira-s-4);
}
</style>
