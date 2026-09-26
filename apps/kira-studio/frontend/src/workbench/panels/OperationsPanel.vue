<script setup lang="ts">
import type { OpRecord } from '@shared/domain/ops';
import { splitSqlStatements } from '@shared/domain/sql-split';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '@workbench/util/virtualRows';
import { computed, ref } from 'vue';
import { control } from '../../bridge/control';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useConnectionsStore } from '../../state/connections';
import { useOpsStore } from '../../state/ops';
import { TAB_KINDS } from '../../state/tabKinds';
import { useTabsStore } from '../../state/tabs';
import { useConsoleViewStore } from '../../views/console/state';
import {
  backslashEscapesFor,
  bracketIdentifiersFor,
  dollarQuotingFor,
  hashCommentsFor,
  nestedBlockCommentsFor,
  postgresEscapeStringsFor,
  sqlDialectFor,
} from '../../views/shared/sqlIdent';
import { ensureConnectedOnce } from '../../views/shared/useConnectionGate';

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

// P104 §3.4: VirtualList's own recipe, rebuilt on @tanstack/vue-virtual via the shared
// useVirtualRows composable -- every row here is a fixed 18px (the same JS/CSS-numeric
// requirement the component's own comment below states).
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => listItems.value.length,
  rowHeight: () => 18,
  scrollElement: scrollEl,
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
// P105 §5.2(c): Enter/Space mirror a single click — the Cancel button nested inside stays its own
// tab stop, so this handler never claims either key from it.
function onRowKeydown(e: KeyboardEvent, record: OpRecord): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  onRowClick(record);
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
    backslashEscapes: backslashEscapesFor(dialect),
    dollarQuoting: dollarQuotingFor(dialect),
    hashComments: hashCommentsFor(dialect),
    nestedBlockComments: nestedBlockCommentsFor(dialect),
    bracketIdentifiers: bracketIdentifiersFor(dialect),
    postgresEscapeStrings: postgresEscapeStringsFor(dialect),
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
      run: () => void onRerun(record),
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
  <div class="h-full flex flex-col min-h-0 text-kira-sm">
    <div class="shrink-0 flex items-center gap-2 py-1 px-2 border-b border-border">
      <div class="flex-none w-40 flex items-center gap-1 h-control rounded-kira-sm border border-border-strong bg-field px-2">
        <CodiconIcon name="filter" :size="13" class="shrink-0 text-muted-foreground" />
        <Input
          v-model="opsStore.filterText"
          placeholder="Filter"
          class="h-full w-full border-0 bg-transparent p-0 font-data focus-visible:ring-0"
          data-testid="ops-filter"
        />
      </div>
      <ToggleGroup
        type="single"
        size="kira"
        :model-value="opsStore.statusFilter"
        @update:model-value="(v) => v && (opsStore.statusFilter = v as (typeof statusFilterOptions)[number]['value'])"
      >
        <ToggleGroupItem v-for="opt in statusFilterOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <span class="ml-auto text-muted-foreground">{{ opsStore.runningCount }} running</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="dialog" size="kira-lg" @click="opsStore.clearOps">Clear</Button>
        </TooltipTrigger>
        <TooltipContent>Clears the in-memory ring only — op_log retention is automatic</TooltipContent>
      </Tooltip>
    </div>

    <div v-if="opsStore.visibleOps.length === 0" class="min-h-0 flex-1">
      <Alert class="h-full flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="checklist" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No operations yet</AlertTitle>
      </Alert>
    </div>
    <template v-else>
      <!-- P110 B36: this grid-cols-[...] arbitrary value is not a new one -- it was already
           @apply'd in this file's own scoped block pre-phase (same "moved, not added" situation
           as SchemaDialog.vue's h-[60vh], B35f), and the shape already has precedent elsewhere
           (GenerateDataDialog.vue, shadcn's own alert/index.ts). Not itemized on plan 1.2's own
           allowlist; flagging for the plan owner to add a matching entry, same as B35f's note. -->
      <div class="grid grid-cols-[90px_140px_40px_80px_90px_70px_60px_1fr] items-center gap-2 px-2 shrink-0 uppercase tracking-wider h-4.5 text-muted-foreground border-b border-border">
        <span>Time</span>
        <span>Connection</span>
        <span>Tab</span>
        <span>Kind</span>
        <span>Status</span>
        <span>Duration</span>
        <span>Rows</span>
        <span>Command</span>
      </div>
      <div
        ref="scrollEl"
        class="flex-1 min-h-0 overflow-auto"
        data-testid="virtual-list"
        role="listbox"
        aria-label="Operations"
        @scroll="onScroll"
      >
        <!--
          The expanded command/error detail rows embed a MonacoHost (D18/D19, P60a) inside a fixed
          virtual row rather than the list itself being variable-height (P2 §0 note 14 leaves it
          fixed on purpose) — `single-line` forces a non-wrapping line and no gutter so it reads
          like the plain text it replaces, just with SQL syntax highlighting. The row height below
          is JS, not CSS (P24 D34) — it has to stay numerically equal to --kira-h-xs (18px), which
          .ops-row/.ops-columns/.ops-detail-row and the embedded .monaco-editor's own height all
          use below.
        -->
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <template v-for="vi in virtualItems" :key="String(vi.key)">
            <div
              v-if="listItems[vi.index].kind === 'op'"
              class="grid grid-cols-[90px_140px_40px_80px_90px_70px_60px_1fr] items-center gap-2 px-2 cursor-pointer select-text h-4.5 hover:bg-hover"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
              :class="[VIRTUAL_ROW_CLASS, { 'text-error': listItems[vi.index].record.status === 'error' }]"
              data-testid="op-row"
              :data-status="listItems[vi.index].record.status"
              role="option"
              tabindex="0"
              @click="onRowClick(listItems[vi.index].record)"
              @keydown="onRowKeydown($event, listItems[vi.index].record)"
              @contextmenu.prevent="onRowContextMenu(listItems[vi.index].record, $event)"
            >
              <span class="font-data" data-testid="op-time-cell">{{ formatTime(listItems[vi.index].record.startedAt) }}</span>
              <span class="flex items-center min-w-0 gap-1">
                <span
                  v-if="connectionFor(listItems[vi.index].record)"
                  class="w-2 h-2 shrink-0 rounded-kira-xs"
                  :style="{ background: connColorVar(connectionFor(listItems[vi.index].record)?.color) ?? 'none' }"
                />
                <span class="truncate min-w-0">{{ connectionFor(listItems[vi.index].record)?.name ?? '—' }}</span>
              </span>
              <span class="truncate min-w-0" data-testid="op-tab-cell">{{ tabTitleFor(listItems[vi.index].record) }}</span>
              <span>{{ listItems[vi.index].record.kind }}</span>
              <span class="flex items-center gap-1">
                <CodiconIcon v-if="listItems[vi.index].record.status === 'running'" name="loading" class="animate-spin" :size="13" />
                {{ listItems[vi.index].record.status }}
                <button
                  v-if="listItems[vi.index].record.status === 'running'"
                  type="button"
                  class="bg-transparent border-0 cursor-pointer p-0 flex text-muted-foreground"
                  aria-label="Cancel operation"
                  @click.stop="onCancel(listItems[vi.index].record)"
                >
                  <CodiconIcon name="debug-stop" :size="13" />
                </button>
              </span>
              <span>{{ formatDuration(listItems[vi.index].record.durationMs) }}</span>
              <span>{{ listItems[vi.index].record.rows ?? '—' }}</span>
              <Tooltip v-if="listItems[vi.index].record.status === 'error'">
                <TooltipTrigger as-child>
                  <span class="font-data truncate min-w-0 text-error block">{{ listItems[vi.index].record.error }}</span>
                </TooltipTrigger>
                <TooltipContent>{{ listItems[vi.index].record.error ?? '' }}</TooltipContent>
              </Tooltip>
              <Tooltip v-else>
                <TooltipTrigger as-child>
                  <span class="font-data truncate min-w-0 block">{{ listItems[vi.index].record.command ?? '—' }}</span>
                </TooltipTrigger>
                <TooltipContent>{{ listItems[vi.index].record.command ?? '' }}</TooltipContent>
              </Tooltip>
            </div>
            <div
              v-else-if="listItems[vi.index].kind === 'detail-command'"
              class="grid items-center grid-cols-1 overflow-hidden text-ellipsis whitespace-nowrap h-4.5 text-muted-foreground bg-elevated p-0 ops-detail-cm"
              :class="VIRTUAL_ROW_CLASS"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
            >
              <MonacoHost
                :doc="
                  listItems[vi.index].record.commandTruncated
                    ? `command (truncated at 64 KiB — cannot Re-run): ${listItems[vi.index].record.command}`
                    : `command: ${listItems[vi.index].record.command}`
                "
                :language="listItems[vi.index].record.kind === 'http' ? 'plain' : 'sql'"
                :sql-dialect="opSqlDialect(listItems[vi.index].record)"
                :read-only="true"
                :single-line="true"
              />
            </div>
            <div
              v-else
              class="grid items-center grid-cols-1 overflow-hidden text-ellipsis whitespace-nowrap h-4.5 text-muted-foreground bg-elevated p-0 ops-detail-cm"
              :class="VIRTUAL_ROW_CLASS"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
            >
              <MonacoHost
                :doc="`error: ${listItems[vi.index].record.error}`"
                language="plain"
                :read-only="true"
                :single-line="true"
              />
            </div>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P110 B36: every rule this file had (.ops-panel/-header/-columns/-body/-row/.filter-input/
   .running-count/.connection-cell/.chip/.truncate/.error-text/.status-cell/.cancel-button/
   .ops-detail-row) moved onto the template elements as Tailwind utilities. The 3 shared-selector
   rules (.ops-columns/.ops-row/.ops-detail-row for the grid template, and .ops-detail-row's own
   second rule overriding grid-cols-1) were resolved per-element rather than stacked (1.3):
   .ops-detail-cm's own `p-0` always won over the shared rule's own padding on every real instance
   (both detail-row kinds always carry both classes together), so the merged detail-row elements
   use p-0 alone with no px-2 alongside it. `.truncate`'s own custom rule duplicated Tailwind's own
   built-in `truncate` utility for 3 of its 4 declarations (overflow-hidden/text-ellipsis/
   whitespace-nowrap) -- template keeps the bare `truncate` class name (now resolving to the real
   utility once this rule is gone) plus an explicit `min-w-0`, the one declaration the built-in
   utility doesn't carry. `.ops-row.error`'s conditional is now bound to `text-error` directly in
   the same `:class` object rather than kept as a `.error` marker with no test dependency (grepped
   apps/kira-studio/tests).

   `.ops-detail-cm` stays a bare marker class -- its own :deep(.monaco-editor)/
   :deep(.monaco-scrollable-element)/:deep(.view-line) rules below target Monaco's own internal
   DOM; plan 5.15 keeps the SELECTORS as CSS (no template to put a class on), but their
   declarations still convert to @apply where they map to a real utility (P110 B37). */
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

/* P110 I2-15: `.virtual-row` moved to VIRTUAL_ROW_CLASS (packages/workbench/src/util/
   virtualRows.ts), bound on each row `:class` -- see ProjectTree.vue's identical note. */
</style>
