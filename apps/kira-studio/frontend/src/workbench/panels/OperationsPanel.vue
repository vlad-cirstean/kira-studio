<script setup lang="ts">
import type { OpRecord } from '@shared/domain/ops';
import { splitSqlStatements } from '@shared/domain/sql-split';
import { connColorVar } from '@theme/connColor';
import OpLogPanel from '@workbench/components/OpLogPanel.vue';
import { type OpLogColumn, opLogMenuItems } from '@workbench/components/opLog';
import type { MenuItem } from '@workbench/state/contextMenu';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useModeStore, workspaceKeyOf } from '../../state/mode';
import { useOpsStore } from '../../state/ops';
import { TAB_KINDS } from '../../state/tabKinds';
import { useTabsStore } from '../../state/tabs';
import { useConsoleViewStore } from '../../views/console/state';
import { lexOptionsFor, sqlDialectFor } from '../../views/shared/sqlIdent';
import { ensureConnectedOnce } from '../../views/shared/useConnectionGate';

// P132 Part 1 (§2.3): rewritten onto the shared packages/workbench OpLogPanel.vue/createOpLogStore
// — this file keeps only Studio's own seams: the connection/tab/rows columns, the Monaco detail
// view, and Re-run/Reveal-originating-tab (opLogMenuItems supplies Copy command/Copy error/Cancel).
const opsStore = useOpsStore();
const connectionsStore = useConnectionsStore();
const tabsStore = useTabsStore();
const modeStore = useModeStore();
const consoleViewStore = useConsoleViewStore();

const columns: OpLogColumn[] = [
  { id: 'time', label: 'Time', width: '90px' },
  { id: 'connection', label: 'Connection', width: '140px' },
  { id: 'tab', label: 'Tab', width: '40px' },
  { id: 'kind', label: 'Kind', width: '80px' },
  { id: 'status', label: 'Status', width: '90px' },
  { id: 'duration', label: 'Duration', width: '70px' },
  { id: 'rows', label: 'Rows', width: '60px' },
  { id: 'command', label: 'Command', width: '1fr' },
];

function connectionFor(record: OpRecord) {
  return connectionsStore.connectionRecord(record.connectionId);
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
  const tab = record.tabId ? tabsStore.tabs.find((t) => t.id === record.tabId) : undefined;
  if (!tab) return;
  // The dock lists every mode's ops: switch to the tab's own workspace so the reveal is visible.
  modeStore.setMode(workspaceKeyOf(tab));
  tabsStore.activateTab(tab.id);
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
//
// P108 Part 11 F5: two fixes on top of D10's original shape. (1) The tab now opens at
// record.path — the same database/schema the op actually ran against (op_log.path, F5) — not the
// connection's bare default, which could silently replay unqualified DML against a different
// database's same-named table. A pre-F5 row has no recorded path (null/undefined); it falls back
// to '' exactly as D10 always did. There is no separate "does this path still exist" pre-check:
// the reconnect step below dials this exact path the same way Run always does, so a path that no
// longer resolves (a dropped database/schema) surfaces as that same real, descriptive connect
// error instead of silently running somewhere else — refusing to run against the wrong target
// covers the finding's own "refuse" requirement without a second, parallel existence check. (2)
// Routes through the same reconnect step ConsoleView.vue's own ensureConnectedForRun wraps — Run
// itself never fires against a disconnected connection, and Re-run must not either.
//
// P108 Part 12 F16: ensureConnectedOnce (not useConnectionGate — see its own doc comment) is used
// here rather than the reactive gate every live tab's own view binds to a template: Re-run fires
// from a context-menu click, well after this component's setup has already returned, so a fresh
// useConnectionGate() call here built each of its two computed()s with no owning effect scope to
// ever dispose them — a small, permanent leak on every Re-run. It also now checks whether the
// connect actually succeeded: Go's Connect never rejects for a bad connection, it resolves with
// that state, so a reconnect that lands on 'error' used to still run markHydrated and the SQL
// below against a connection that was never actually connected. A genuine rejection (the IPC call
// itself failing) is caught rather than left as an unhandled promise rejection — onRerun runs
// fire-and-forget from the context menu (`run: () => void onRerun(record)`), so nothing else would
// ever see it. Either way the tab this already opened is left showing its own reconnect gate
// (ensureConnectedOnce never marks it hydrated on a failure) — no toast to build for it: that is
// the same feedback every other reconnect-gated view already gives on a failed connect.
async function onRerun(record: OpRecord): Promise<void> {
  if (!record.connectionId || !record.command || record.commandTruncated) return;
  const dialect = opSqlDialect(record);
  const statements = splitSqlStatements(record.command, {
    ...lexOptionsFor(dialect),
    slashSlashComments: connectionFor(record)?.kind === 'mongodb',
  }).map((s) => s.text);
  if (statements.length === 0) return;
  const tabId = tabsStore.openConsoleTab(record.connectionId, record.path ?? '');
  try {
    const connected = await ensureConnectedOnce(tabId, record.connectionId);
    if (!connected) return;
    await consoleViewStore.run(tabId, statements);
  } catch (err) {
    console.error('Re-run: failed to reconnect/run', err);
  }
}

function menuFor(record: OpRecord): MenuItem[] {
  const hasTab = record.tabId !== null && tabsStore.tabs.some((t) => t.id === record.tabId);
  const canSql = !!record.connectionId && connectionsStore.states[record.connectionId]?.caps?.sql;
  const [copyCommand, copyError, cancel] = opLogMenuItems(record, () =>
    opsStore.cancelOp(record.id),
  );
  return [
    {
      type: 'item',
      id: 'reveal-tab',
      label: 'Reveal originating tab',
      disabled: !hasTab,
      run: () => revealTab(record),
    },
    copyCommand,
    copyError,
    {
      type: 'item',
      id: 're-run',
      label: 'Re-run',
      icon: 'play',
      // P23 D1(c): a truncated command is only a 64 KiB prefix of what actually ran — Copy
      // command stays enabled (copying a prefix is honest and useful), but Re-run must not.
      disabled: !record.command || !canSql || record.commandTruncated,
      run: () => void onRerun(record),
    },
    cancel,
  ];
}
</script>

<template>
  <OpLogPanel
    v-model:filter-text="opsStore.filterText"
    v-model:status-filter="opsStore.statusFilter"
    :records="opsStore.visibleOps"
    :running-count="opsStore.runningCount"
    :columns="columns"
    clear-hint="Clears the in-memory ring only — op_log retention is automatic"
    :menu-for="menuFor"
    @clear="opsStore.clearOps"
    @cancel="(record) => opsStore.cancelOp(record.id)"
  >
    <template #cell="{ column, record }">
      <span v-if="column.id === 'connection'" class="flex items-center min-w-0 gap-1">
        <span
          v-if="connectionFor(record)"
          class="w-2 h-2 shrink-0 rounded-kira-xs"
          :style="{ background: connColorVar(connectionFor(record)?.color) ?? 'none' }"
        />
        <span class="truncate min-w-0">{{ connectionFor(record)?.name ?? '—' }}</span>
      </span>
      <span v-else-if="column.id === 'tab'" class="truncate min-w-0" data-testid="op-tab-cell">{{
        tabTitleFor(record)
      }}</span>
      <span v-else-if="column.id === 'rows'">{{ record.rows ?? '—' }}</span>
    </template>
    <template #detail="{ record, part }">
      <div class="ops-detail-cm h-full min-w-0">
        <MonacoHost
          v-if="part === 'command'"
          :doc="
            record.commandTruncated
              ? `command (truncated at 64 KiB — cannot Re-run): ${record.command}`
              : `command: ${record.command}`
          "
          :language="record.kind === 'http' ? 'plain' : 'sql'"
          :sql-dialect="opSqlDialect(record)"
          :read-only="true"
          :single-line="true"
        />
        <MonacoHost v-else :doc="`error: ${record.error}`" language="plain" :read-only="true" :single-line="true" />
      </div>
    </template>
  </OpLogPanel>
</template>

<style scoped>
@reference "@theme/base.css";

/* P132 Part 1 (§2.3): moved from the pre-shared OperationsPanel.vue unchanged — the slot root
   above (`.ops-detail-cm`) is rendered by this component, so it still carries this component's own
   scope id, and these :deep() rules still match Monaco's internal DOM the same way they always
   did. */
.ops-detail-cm :deep(.monaco-editor) {
  @apply h-4.5 text-kira-sm;
}

/* The detail row is a single fixed-height (20px) line — VirtualList (P2 §0 note 14) has no
   notion of a variable-height row — so a long command can't wrap into view. Horizontal scroll
   (trackpad/shift-wheel/drag, same as the tab strip) is what actually lets you read all of it,
   rather than clipping it exactly like the collapsed row it replaces. `single-line` (above)
   already turns wordWrap off and the gutter off; this only adds the left/right breathing room
   `.cm-line`'s own padding used to give each row. */
.ops-detail-cm :deep(.monaco-scrollable-element) {
  @apply overflow-x-auto overflow-y-hidden;
}

.ops-detail-cm :deep(.view-line) {
  /* P110 B37: padding: 0 var(--kira-s-4) (8px sides) -> px-2. */
  @apply px-2;
}
</style>
