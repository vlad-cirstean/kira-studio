<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import type { EditorLanguageId } from '@shared/domain/editor';
import { splitSqlStatements, statementAtCursor, statementAtOffset } from '@shared/domain/sql-split';
import { pathTail } from '@shared/domain/tree';
import { useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { registerCommand } from '@workbench/shortcuts/commands';
import { useContextMenuStore } from '@workbench/state/contextMenu';
import { wheelToHorizontal } from '@workbench/util/wheelScroll';
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import { useCellSelectionStore } from '../../state/cellSelection';
import { useConnectionsStore } from '../../state/connections';
import { useRunState } from '../../state/runState';
import { containerPathFor, useSchemaColumnsStore } from '../../state/schemaColumns';
import { ddlSchemaFor, schemaQueryOptions } from '../../state/schemas';
import type { ConsoleTabRecord } from '../../state/tabDomain';
import EngineIcon from '../../theme/EngineIcon.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import {
  backslashEscapesFor,
  bracketIdentifiersFor,
  dollarQuotingFor,
  hashCommentsFor,
  nestedBlockCommentsFor,
  postgresEscapeStringsFor,
  type SqlDialect,
  sqlDialectFor,
} from '../shared/sqlIdent';
import { useConnectionGate } from '../shared/useConnectionGate';
import ConsoleResultGrid from './ConsoleResultGrid.vue';
import ConsoleSavedMenu from './ConsoleSavedMenu.vue';
import { consoleCompletionSources } from './completion';
import ExplainResultView from './ExplainResultView.vue';
import { isExplainable } from './explain';
import { canFormatConsole, formatConsoleText } from './format';
import { consoleLintSource } from './lint';
import { getPage } from './resultPages';
import { type Match, pageSearchApi } from './search';
import { sqlHoverSource } from './sqlHover';
import { setNewResultSet, setText, useConsoleViewStore } from './state';

const contextMenuStore = useContextMenuStore();
const schemaColumnsStore = useSchemaColumnsStore();
const connectionsStore = useConnectionsStore();
const consoleViewStore = useConsoleViewStore();
const cellSelectionStore = useCellSelectionStore();

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DataView.vue.
const props = defineProps<{ tab: ConsoleTabRecord }>();
const hasCellDock = computed(() => cellSelectionStore.selectedCellFor(props.tab.id) !== null);

// A console tab hydrates without loading anything (there is nothing to load until a statement
// runs), so no onLoad is passed.
const { needsReconnect, onReconnectAndLoad } = useConnectionGate(() => props.tab);

const rt = computed(() => consoleViewStore.runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');

// P108 Part 11 F11: `running` only reflects rt.status, which run()/explain() sets synchronously
// the instant either is actually called (state.ts's own run() sets rt.status = 'running' before
// its own first internal await) — but ensureConnectedForRun's own reconnect await stands between
// the guard below and that call. A second click/Ctrl+Enter/palette command during a slow reconnect
// passed the (still false) `running` guard, and the toolbar button was still enabled -- both runs
// executed server-side (an INSERT pressed twice while reconnecting inserted twice), and the
// first run's own result was discarded as superseded by the second. `starting` covers exactly that
// window: set before the reconnect await, cleared right after it resolves and before run()/
// explain() is called -- by the time either actually runs, `running` has already taken over.
const starting = ref(false);

const targetTail = computed(() => pathTail(props.tab.path));

// P104 §3: ViewChrome/ViewHeader/RunState inlined -- railColor mirrors ViewChrome.vue's own
// `envColor ?? (connection ? connection.color ?? null : undefined)`; this view has no envColor.
const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const railColor = computed(() => (connRecord.value ? (connRecord.value.color ?? null) : undefined));
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});

const connectionKind = computed<ConnectionKind | undefined>(() => connRecord.value?.kind);

const dialect = computed(() => sqlDialectFor(connectionKind.value));

// F10/P21 round 1: the one place backslashEscapes/dollarQuoting are paired for every
// splitSqlStatements/statementAtCursor call below — dollarQuoting is Postgres-only (a MySQL
// identifier containing two `$` used to read as an unterminated dollar-quote open tag and swallow
// the rest of the document into one statement).
// P108 Part 11 F4: also the one place a Mongo console's own `//` line comments get recognised —
// `dialect` stays undefined for Mongo (sqlDialectFor has no Mongo member), so that flag reads
// connectionKind.value directly rather than through the per-SqlDialect helpers above it.
function splitOptionsFor(d: SqlDialect | undefined) {
  return {
    backslashEscapes: backslashEscapesFor(d),
    dollarQuoting: dollarQuotingFor(d),
    hashComments: hashCommentsFor(d),
    nestedBlockComments: nestedBlockCommentsFor(d),
    bracketIdentifiers: bracketIdentifiersFor(d),
    postgresEscapeStrings: postgresEscapeStringsFor(d),
    slashSlashComments: connectionKind.value === 'mongodb',
  };
}

// P18 addendum D23: realities #10's wart, fixed as a side effect of needing per-engine behaviour
// at all — a Mongo shell command has been coloured by the SQL grammar since P5.5. `language`
// (not a hardcoded "sql") now drives both highlighting and, via `completionSources`, what
// autocomplete offers.
const language = computed<EditorLanguageId>(() => {
  if (connectionKind.value === 'mongodb') return 'mongo';
  if (connectionKind.value === 'redis') return 'redis';
  if (dialect.value !== undefined) return 'sql';
  return 'plain';
});

// P18 (v1.1) C5/D5: a SQL console's own DDL document, loaded once per connection and re-parsed
// only when its text actually changes (state/schemas.ts's own memoisation) — undefined dialect
// (a non-SQL console) never fires the load at all. `documentDdlSchema` is the hand-authored
// document alone — D4's completion still takes it as a separate, first-priority argument, so it
// must not be pre-merged with the cache the way `ddlSchema` below is for lint/hover.
// P99 §5.5: a reactive useQuery (not the imperative ensureDdl) so a remote onSchemaChanged
// broadcast's applyRemote (state/schemas.ts, F1) writes straight into this query's cache and this
// recomputes — the old version read a reactive field a broadcast wrote directly, and must keep
// updating the same way.
const ddlQuery = useQuery(() => ({
  ...schemaQueryOptions(props.tab.connectionId ?? ''),
  enabled: !!props.tab.connectionId && dialect.value !== undefined,
}));
const documentDdlSchema = computed(() =>
  ddlSchemaFor(props.tab.connectionId ?? '', ddlQuery.data.value, dialect.value),
);

// P22c D3: this console's own container (the schema/database its path resolves to) — the same
// container consoleRelationNames (completion.ts) already resolves relation names against.
const containerPath = computed(() =>
  props.tab.connectionId ? containerPathFor(props.tab.connectionId, props.tab.path) : null,
);

// P22c D3/D5: warms this container's cached columns once per (connection, container) — a view's
// own lifecycle hook, never a CompletionSource, never on a keystroke. Resolves from the Go-side
// cache with no connection when one is cached (F7); a no-op when already loaded or in flight.
//
// P108 Part 12 F5: `generationFor` is the third source — a reconnect or tree Refresh drops the
// cached entry (schemaColumns.ts's dropSchemaColumns) with no change to connectionId/containerPath,
// so without it this watch never re-fired and a mounted console's completion stayed empty until
// the tab remounted. ensureSchemaColumns is still the no-op it always was for every OTHER
// generation bump (an unrelated connection's invalidation, or this one's entry already refetched).
watch(
  () =>
    [
      props.tab.connectionId,
      containerPath.value,
      props.tab.connectionId ? schemaColumnsStore.generationFor(props.tab.connectionId) : 0,
    ] as const,
  ([connectionId, path]) => {
    if (connectionId && path) void schemaColumnsStore.ensureSchemaColumns(connectionId, path);
  },
  { immediate: true },
);

// P22c D6: the effective schema diagnostics/hover read — the hand-authored document wins
// wholesale when it has any tables; otherwise the cached columns for this container fill in.
// Completion (below) reads the raw document and the raw cache separately instead (D4), since
// sqlSchemaCompletionSource wants a namespace and its own alias resolution needs the tree's own
// relation names as a distinct fallback layer — but this is the one place lint/hover read, so
// they can never disagree with completion about what the console knows.
const ddlSchema = computed(() =>
  schemaColumnsStore.effectiveSchema(props.tab.connectionId ?? '', containerPath.value ?? '', documentDdlSchema.value),
);

// D21/D22: undefined for any kind with no console at all, which a mounted ConsoleView never
// actually has (caps.sql gates the tab) — `language.value !== 'plain'` covers that without
// special-casing kafka/sqs/s3. The SQL branch is undefined with no DDL document, no cached
// columns and no tree relations for this connection — the keyword completion source
// (sqlKeywordCompletion.ts) stays in charge, byte-for-byte today's behaviour with none of the
// three (P22c D4).
const completionSources = computed(() => {
  if (!connectionKind.value || language.value === 'plain') return undefined;
  if (language.value === 'sql') {
    const connectionId = props.tab.connectionId;
    const cached =
      connectionId && containerPath.value
        ? schemaColumnsStore.cachedRelationsFor(connectionId, containerPath.value)
        : [];
    return consoleCompletionSources(
      connectionKind.value,
      connectionId,
      props.tab.path,
      documentDdlSchema.value,
      cached,
    );
  }
  return consoleCompletionSources(connectionKind.value, props.tab.connectionId, props.tab.path);
});

// D24: one lexical linter per engine, scoped to this console's own text — undefined for any tab
// this view never actually mounts for (caps.sql gates the tab), so `connectionKind.value` is
// always postgres/mariadb/mysql/mongodb/redis in practice.
const lintSource = computed(() => consoleLintSource(connectionKind.value, ddlSchema.value));

// C6/D8: undefined with no DDL document (D5) or a non-SQL kind — MonacoHost's own hoverSource
// prop is additive, so every other console stays exactly as it was.
const hoverSource = computed(() => {
  if (!dialect.value) return undefined;
  return sqlHoverSource(dialect.value, ddlSchema.value);
});

const cursorPos = ref(0);
const savedMenuOpen = ref(false);
// P104: PopoverAnchor's own `:reference` takes the trigger's real DOM node directly (the
// established `.$el` idiom, e.g. GitPanel.vue's promptInput).
const savedMenuTriggerEl = ref<{ $el: HTMLElement } | null>(null);
// D9: the console runtime has no actionError field (rt.status === 'error' means the last *run*
// failed, F11) — a format failure is a client-side text operation with nowhere else to go, so it
// gets its own component-local strip instead of a runtime-shape change.
const formatError = ref<string | null>(null);
// P19 D13: the two silent no-ops F19 named — a partial failure (some statements formatted, one
// didn't) reads as a warn strip rather than err (the press still did something useful), and a
// byte-identical result (an already-formatted document) says so explicitly rather than looking
// like the button did nothing.
const formatWarning = ref<string | null>(null);
const formatNote = ref<string | null>(null);
const canFormat = computed(() => canFormatConsole(connectionKind.value));

// P21 round 2 performance finding 9: statementAtCursorText used to call statementAtCursor
// directly, which re-splits the *entire* document (a quote/comment/dollar-quote state machine
// over every character) on every access — and both this and canExplain/explainTooltip below are
// template-bound, so it re-ran on every render, meaning every character typed *and every bare
// caret move* triggered a full document split. docs/PERF.md's own "Console keystroke -> completion
// popup" measurement (43.4ms p50 against a 50ms budget, the least headroom of any interaction in
// the app) sits on exactly this path. Splitting the document is now its own computed, depending
// only on the document text and dialect (not cursorPos) — a genuine keystroke still re-splits
// once, unavoidably, but a caret move alone (arrow keys, a click) no longer does, since Vue's own
// computed caching skips re-running this one when cursorPos is the only thing that changed.
const splitStatementsForText = computed(() => {
  if (dialect.value === undefined) return [];
  return splitSqlStatements(props.tab.state.text, splitOptionsFor(dialect.value));
});

// P18 (v1.1) C12/D12: the statement the cursor is currently in, undefined for a non-SQL console —
// the single source both the Explain button's disabled state and onExplain() itself read, so the
// two can never disagree about which statement is "current". Now a cheap O(statement count) scan
// over the already-split list above, not a re-split — this is the one that reruns on every caret
// move, so it must stay cheap regardless of document size.
const statementAtCursorText = computed<string | undefined>(() => {
  if (dialect.value === undefined) return undefined;
  // P108 Part 11 F3: shares statementAtCursor's own boundary rule (sql-split.ts) rather than
  // duplicating it — a caret right after a statement's `;`, or on the blank line before the next
  // one, must resolve to the preceding statement here exactly as it does for Run statement/Explain.
  return statementAtOffset(splitStatementsForText.value, props.tab.state.text, cursorPos.value)
    ?.text;
});
// D12: disabled-with-tooltip, not hidden — Explain applies to this *console*, just not to this
// statement, which is a state (like the format button's own disabled-on-empty-text), not a
// capability like Redis having no Format button at all.
// P12 round 1 finding #5: explain() now shares run()'s own opId/status bookkeeping (so it's
// cancellable and shows a busy state) — running must gate this button too, or starting Explain
// while a run is already in flight would silently steal rt.opId out from under it, and the run's
// own eventual response would then read as superseded and get its results discarded.
const canExplain = computed(
  () =>
    !running.value &&
    statementAtCursorText.value !== undefined &&
    isExplainable(statementAtCursorText.value),
);
const explainTooltip = computed(() => {
  if (running.value) return 'A run is already in progress';
  return canExplain.value
    ? 'Explain the statement under the cursor'
    : 'Put the cursor in a SELECT or WITH statement to explain it';
});
// D9's own precedent: a component-local strip, not a runtime-shape change (the manual button's
// own failure is shown; auto-explain's failure path — C14 — degrades silently instead, D19 rule 6).
const explainError = ref<string | null>(null);

// P18 (v1.1) C14/D19: the compact message the auto-explain strip shows — the row estimate (when
// this dialect reports one) plus the first warn-severity issue, e.g. `Estimated to read 184,153
// rows · full table scan on "orders" with a filter`. P12 round 1 finding #8: 'truncated' has no
// plan to summarize — its own message says the check itself couldn't run, not that it found
// nothing.
const autoExplainMessage = computed(() => {
  const state = rt.value?.autoExplain;
  if (!state) return '';
  if (state.kind === 'truncated') {
    return "This query's plan was too large to check for problems — it will still run normally.";
  }
  const worst = state.plans[state.worstIndex]?.plan;
  if (!worst) return '';
  const parts: string[] = [];
  if (worst.estimatedRowsRead !== undefined) {
    parts.push(`Estimated to read ${worst.estimatedRowsRead.toLocaleString()} rows`);
  }
  const firstWarning = worst.issues.find((i) => i.severity === 'warn');
  if (firstWarning) parts.push(firstWarning.message);
  return parts.join(' · ') || 'This query may be expensive to run';
});
const canShowAutoExplainPlan = computed(() => rt.value?.autoExplain?.kind === 'plans');

function onShowAutoExplainPlan(): void {
  consoleViewStore.showAutoExplainPlan(props.tab.id);
}
// Typed as the bare exposed shape (rather than InstanceType<typeof MonacoHost>) so this ref
// doesn't read as a type-only use of the MonacoHost import — same convention as
// ConsoleSavedMenu.vue's promptInput/views/shared/page/SearchToolbar.vue's own template ref.
const editorHost = ref<{
  focus: () => void;
  setCursor: (pos: number) => void;
  setDoc: (text: string) => void;
} | null>(null);
// The saved-queries popover unmounts its own focused entry on close (ConsoleSavedMenu's apply()
// closes right after loading), and nothing else in the tree reclaims focus — without this the
// editor is left unfocused (DOM focus falls to <body>) right after a saved query loads, even
// though the whole point of loading one is to keep working in the editor.
function onSavedMenuClose(): void {
  savedMenuOpen.value = false;
  void nextTick(() => editorHost.value?.focus());
}

// P18 addendum D20: the editor's own doc is a shallowRef, not `tab.state.text` directly — binding
// the template to the tab's reactive text made this view's whole render effect (toolbar, strips,
// status line, every mounted ConsoleResultGrid) re-run on every keystroke, for no benefit
// MonacoHost's own equality-guarded `doc` watcher didn't already provide. `lastEmitted` is a
// plain variable, not a ref — comparing against it is what lets an external write (a saved-query
// load, tab hydration) still reach the editor while a self-triggered echo does not.
const localDoc = shallowRef(props.tab.state.text);
let lastEmitted = props.tab.state.text;

// P12 round 1 finding #7: the three strips below are stale the moment the text they describe is
// gone — not only on a keystroke (onDocChange), but also on any *external* text replacement
// (ConsoleSavedMenu's apply(), this view's own onFormat() below), both of which call setText()
// directly and go through MonacoHost's external-sync path, which deliberately never re-emits
// update:doc (the watcher below is what notices those instead). Shared so neither path can drift.
function resetStalePreviewState(): void {
  formatError.value = null;
  formatWarning.value = null;
  formatNote.value = null;
  explainError.value = null;
  // D19: the auto-explain strip clears on the next document edit, same as the two above.
  consoleViewStore.clearAutoExplain(props.tab.id);
}

function onDocChange(text: string): void {
  lastEmitted = text;
  setText(props.tab.id, text);
  resetStalePreviewState();
}

watch(
  () => props.tab.state.text,
  (text) => {
    if (text === lastEmitted) return;
    // The editor is about to hold exactly this, so the echo guard must say so — otherwise the next
    // keystroke is compared against text the editor no longer has.
    lastEmitted = text;
    // Keeps the prop honest for a remount/the pending <pre>; may be a no-op when this text was
    // already pushed once, which is exactly why the write below cannot be left to it (P89 §5).
    localDoc.value = text;
    editorHost.value?.setDoc(text);
    resetStalePreviewState();
  },
);

// Item 4 (regression pass, task batch P46-4): the console has no Refresh button — Run/Run all are
// its own two start verbs (see the #toolbar comment above) — so they're what now carries the
// gate's own job: pressing either on a restored/disconnected tab reconnects first, exactly what
// the removed "Reconnect & load" gate used to require a separate press for.
async function ensureConnectedForRun(): Promise<void> {
  if (needsReconnect.value) await onReconnectAndLoad();
}

function runStatement(): void {
  // P12 round 2 finding #4: the toolbar's Run button is disabled while running (below), but the
  // command (⌘↵/palette) had no such gate — two overlapping runs raced explainOpId/opId bookkeeping.
  // F11: `starting` covers the reconnect-await window `running` can't (see its own doc comment).
  if (running.value || starting.value) return;
  const stmt = statementAtCursor(
    props.tab.state.text,
    cursorPos.value,
    splitOptionsFor(dialect.value),
  );
  if (!stmt) return;
  void (async () => {
    starting.value = true;
    try {
      await ensureConnectedForRun();
    } finally {
      starting.value = false;
    }
    await consoleViewStore.run(props.tab.id, [stmt.text]);
  })();
}

function runAll(): void {
  if (running.value || starting.value) return;
  const statements = splitSqlStatements(props.tab.state.text, splitOptionsFor(dialect.value)).map(
    (s) => s.text,
  );
  if (statements.length === 0) return;
  void (async () => {
    starting.value = true;
    try {
      await ensureConnectedForRun();
    } finally {
      starting.value = false;
    }
    await consoleViewStore.run(props.tab.id, statements);
  })();
}

function onStop(): void {
  consoleViewStore.stop(props.tab.id);
}

// P19 D12(3): maps the caret across the reformat by statement INDEX, not offset — formatting
// rewrites every offset in the document, so an offset means nothing afterwards, whereas the
// statement the user was working in is exactly what they expect to still be under the caret (and
// what Run statement itself reads, P13 OQ-2). Exact whenever the statement count is preserved,
// which D13 guarantees (a statement Format couldn't format is emitted verbatim, never dropped).
function onFormat(): void {
  const kind = connectionKind.value;
  if (!kind || !canFormat.value) return;
  const splitOptions = splitOptionsFor(dialect.value);
  const before = splitSqlStatements(props.tab.state.text, splitOptions);
  const beforeIndex = before.findIndex(
    (s) => cursorPos.value >= s.start && cursorPos.value <= s.end,
  );
  const originalText = props.tab.state.text;
  void (async () => {
    const result = await formatConsoleText(kind, originalText);
    // P108 Part 11 F13: the first Format press awaits a dynamic import('sql-formatter') — a
    // keystroke typed before it resolves used to be silently overwritten by the formatted version
    // of the OLDER text underneath it. `result` was computed against `originalText`, which is no
    // longer what's in the editor, so it's discarded outright rather than applied: not a partial
    // success to react to (resetStalePreviewState/setText/the cursor remap/the warning-or-note
    // strips below all assume `result` describes the document currently on screen).
    if (props.tab.state.text !== originalText) {
      formatNote.value = 'Text changed while formatting — press Format again.';
      return;
    }
    // Explicit, not left to the watch() above alone: an already-formatted document formats to
    // byte-identical text, which never triggers that watcher (props.tab.state.text doesn't
    // change) — Format succeeding is still a "next action" that should clear a stale explain/
    // auto-explain strip even when the text itself doesn't move (P12 round 1 finding #7).
    resetStalePreviewState();
    if (!result.ok) {
      formatError.value = result.reason ?? 'could not format this query';
      return;
    }
    setText(props.tab.id, result.text);
    if (beforeIndex >= 0) {
      const after = splitSqlStatements(result.text, splitOptions);
      const target = after[beforeIndex];
      void nextTick(() => editorHost.value?.setCursor(target?.start ?? 0));
    }
    // D13: set only after setText's own reactive round trip has settled — the
    // props.tab.state.text watcher above also calls resetStalePreviewState() whenever the text
    // actually changed (a partial-success/full-success reformat always does), which would
    // otherwise wipe these strips the instant they're set.
    void nextTick(() => {
      if (result.failures.length > 0) {
        const first = result.failures[0];
        if (first) {
          const formattedCount = before.length - result.failures.length;
          formatWarning.value = `Formatted ${formattedCount} of ${before.length} statements — statement ${first.index + 1} could not be parsed: ${first.reason}`;
        }
      } else if (result.text === originalText) {
        // F19's other silent no-op: keywordCase: 'preserve' (P13 D4) means Format only ever
        // touches whitespace — pressing it on an already-indented document changes nothing, and
        // without this nothing distinguished "already formatted" from "the button is dead".
        // P22b D13: reworded to name the reason rather than assert a bare null result — once D12
        // fixed the semicolon-deletion bug, this note is the whole remaining substance of "Format
        // looks broken" (F19): the difference between "the button is dead" and "the button ran
        // and there was nothing to change".
        formatNote.value =
          kind === 'clickhouse'
            ? 'Already formatted — indentation only; keywords keep the case you typed (ClickHouse identifiers).'
            : 'Already formatted — indentation only; keywords keep the case you typed.';
      }
    });
  })();
}

function onExplain(): void {
  const kind = connectionKind.value;
  const stmt = statementAtCursorText.value;
  if (!kind || !stmt || !canExplain.value || starting.value) return;
  void (async () => {
    starting.value = true;
    try {
      await ensureConnectedForRun();
    } finally {
      starting.value = false;
    }
    const result = await consoleViewStore.explain(props.tab.id, kind, stmt);
    explainError.value = result.ok ? null : result.reason;
  })();
}

// --- search: the shared find toolbar over the active result set (P40 D8/D9). Mirrors
// KeyValueView.vue's own onToggleSearch/onCloseSearch discipline exactly. -----------------------
function onToggleSearch(): void {
  consoleViewStore.toggleSearchOpen(props.tab.id);
}
function onCloseSearch(): void {
  consoleViewStore.setSearchOpen(props.tab.id, false);
}

const resultGridRef = ref<{
  goToMatch: (match: Match) => void;
  expandAll: () => void;
  collapseAll: () => void;
} | null>(null);
// Item (regression pass, task batch P46-4): expand-all/collapse-all only make sense while the
// active result is document-shaped (Mongo) — same getPage(key)?.kind check iconForResult below
// already makes, just gating a different pair of buttons instead of an icon.
const activeResultIsDocument = computed(
  () => getPage(rt.value?.activeKey ?? '')?.kind === 'document',
);
// P18 D17: the find toolbar resolves a Page (search.ts's activePage) and a plan result set is not
// one — gated off here the same way the expand/collapse-all pair above is gated on document-ness,
// rather than left to just silently find nothing.
const activeResultIsPlan = computed(
  () => rt.value?.results.find((r) => r.key === rt.value?.activeKey)?.kind === 'plan',
);
function onExpandAllResults(): void {
  resultGridRef.value?.expandAll();
}
function onCollapseAllResults(): void {
  resultGridRef.value?.collapseAll();
}
function onGoToMatch(match: Match): void {
  resultGridRef.value?.goToMatch(match);
}

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  unregisterCommands = [
    registerCommand('view.run', runStatement),
    registerCommand('view.run-all', runAll),
    registerCommand('view.format', onFormat),
    registerCommand('view.explain', onExplain),
    registerCommand('view.find', onToggleSearch),
  ];
});

onUnmounted(() => {
  for (const off of unregisterCommands) off();
});

// P42 D6: a leading icon per result set's own page kind — the only thing that says which kind a
// chip holds once a Mongo or Redis console can produce more than one kind of result set at once.
const RESULT_KIND_ICON: Record<string, string> = {
  tabular: 'table',
  document: 'json',
  keyvalue: 'symbol-key',
};
// P18 D17: a plan result set has no Page at all (getPage(key) resolves undefined), so its icon is
// resolved from ConsoleResult.kind directly rather than through resultPages.ts's own map.
function iconForResult(key: string): string {
  if (rt.value?.results.find((r) => r.key === key)?.kind === 'plan') return 'list-tree';
  return RESULT_KIND_ICON[getPage(key)?.kind ?? ''] ?? 'table';
}

function onResultMiddleClick(key: string): void {
  consoleViewStore.closeResult(props.tab.id, key);
}

// P42 D8: the same three items TabStrip.vue's own tab row leads with, over one tab's result sets
// instead of the app's whole tab list — disabled rather than hidden when they would be a no-op.
function onResultContextMenu(e: MouseEvent, key: string, index: number): void {
  const total = rt.value?.results.length ?? 0;
  contextMenuStore.openContextMenu(e, [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      run: () => consoleViewStore.closeResult(props.tab.id, key),
    },
    {
      type: 'item',
      id: 'close-other-results',
      label: 'Close others',
      disabled: total <= 1,
      run: () => consoleViewStore.closeOtherResults(props.tab.id, key),
    },
    {
      type: 'item',
      id: 'close-results-to-the-right',
      label: 'Close to the right',
      disabled: index >= total - 1,
      run: () => consoleViewStore.closeResultsToTheRight(props.tab.id, key),
    },
  ]);
}

const resultStripRef = ref<HTMLElement | null>(null);
function onResultStripWheel(e: WheelEvent): void {
  if (wheelToHorizontal(resultStripRef.value, e)) e.preventDefault();
}

const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  if (r.status === 'running') return 'Running…';
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.status === 'idle' && r.results.length > 0) {
    return `${r.results.length} result${r.results.length === 1 ? '' : 's'}`;
  }
  return '';
});
</script>

<template>
  <div class="console-view" data-testid="console-view" :data-path="tab.path">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined -- no component wraps this chrome anymore. -->
    <div class="p-view-head">
      <span
        v-if="railColor !== undefined"
        class="p-conn-dot"
        :class="{ none: !railColor || railColor === 'none' }"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span v-if="connectionKind" class="size-4 flex items-center justify-center shrink-0">
        <EngineIcon :kind="connectionKind" :size="13" />
      </span>
      <span class="size-4 flex items-center justify-center shrink-0">
        <CodiconIcon name="terminal" :size="13" />
      </span>
      <span class="p-view-target" data-testid="console-target">{{
        targetTail?.name ?? tab.path ?? 'Console'
      }}</span>
      <span class="ml-auto flex items-center gap-1"></span>
    </div>

    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar last">
      <div class="group">
        <!-- The console's search_path/schema control and the "writes go to production" chip from
             Console.html both need tracked data this app does not have yet (no per-console
             schema, no per-connection write-warning flag) — skipped rather than faked. Refresh
             itself still isn't a third start verb (Run/Run all cover that, and now reconnect on
             their own — see runStatement/runAll above): it stays disabled whenever there's nothing
             to reconnect, and is only ever the reconnect trigger while gated, so it's never a dead,
             permanently-grey button sitting in the rail for no reason a user can see. -->
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                data-testid="console-refresh"
                :disabled="!needsReconnect"
                aria-label="Refresh"
                @click="onReconnectAndLoad"
              >
                <CodiconIcon name="refresh" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira-icon"
                :class="{ 'text-error': running }"
                data-testid="console-stop"
                :disabled="!running"
                aria-label="Stop"
                @click="onStop"
              >
                <CodiconIcon name="debug-stop" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </div>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar-primary"
                size="kira"
                data-testid="console-run-statement"
                :disabled="running || starting"
                @click="runStatement"
              >
                <CodiconIcon name="play" :size="13" />
                Run
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Run the statement under the cursor</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira"
                data-testid="console-run-all"
                :disabled="running || starting"
                @click="runAll"
              >
                <CodiconIcon name="run-all" :size="13" />
                Run all
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Run every statement in the editor</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canFormat">
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira"
                data-testid="console-format"
                :disabled="!tab.state.text.trim()"
                @click="onFormat"
              >
                <CodiconIcon name="indent" :size="13" />
                Format
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Format the query text</TooltipContent>
        </Tooltip>
        <!-- P18 D12: SQL-only (unlike Format, which also covers the Mongo console) — absent, not
             disabled, on a non-SQL console; disabled-with-tooltip (not hidden) on a SQL console
             whose statement at the cursor isn't a SELECT/WITH, since Explain applies to this
             console and just not to this particular statement. -->
        <Tooltip v-if="dialect">
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira"
                data-testid="console-explain"
                :disabled="!canExplain || starting"
                @click="onExplain"
              >
                <CodiconIcon name="list-tree" :size="13" />
                Explain
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ explainTooltip }}</TooltipContent>
        </Tooltip>
        <div class="sep"></div>
        <!-- P40 D6, default re-flipped back on P46-2: append a new result set instead of replacing
             the current ones. On (appending) by default and per-tab, shown unpressed — pressing
             this is what makes a run replace the last result set instead of stacking a new one,
             so the pressed/"active" look tracks *replace* mode, the inverse of the stored flag. -->
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg is-active': !tab.state.newResultSet }"
              aria-label="New result set toggle"
              data-testid="console-new-result-toggle"
              @click="setNewResultSet(tab.id, !tab.state.newResultSet)"
            >
              <CodiconIcon name="layers" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            tab.state.newResultSet
              ? 'Running adds a new result set — click to replace instead'
              : 'Running replaces the current result sets — click to add a new one instead'
          }}</TooltipContent>
        </Tooltip>
        <div class="sep"></div>
        <div class="saved-anchor">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                ref="savedMenuTriggerEl"
                variant="toolbar"
                size="kira"
                data-testid="console-saved-toggle"
                @click="savedMenuOpen = !savedMenuOpen"
              >
                <CodiconIcon name="bookmark" :size="13" />
                Saved queries
              </Button>
            </TooltipTrigger>
            <TooltipContent>Saved queries</TooltipContent>
          </Tooltip>
          <Popover :open="savedMenuOpen" @update:open="(v) => (savedMenuOpen = v)">
            <PopoverAnchor :reference="(savedMenuTriggerEl?.$el as HTMLElement) ?? undefined" class="hidden" />
            <ConsoleSavedMenu v-if="savedMenuOpen" :tab-id="tab.id" @close="onSavedMenuClose" />
          </Popover>
        </div>
        <div class="sep"></div>
        <!-- D17: the find toolbar resolves a Page — a plan result set is not one, so the button
             is gated off the same way expand/collapse-all above is gated on document-ness. -->
        <Tooltip v-if="!activeResultIsPlan">
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-field text-fg': !!rt?.searchOpen }"
              aria-label="Find in the active result set"
              data-testid="console-search"
              @click="onToggleSearch"
            >
              <CodiconIcon name="search" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Find in the active result set</TooltipContent>
        </Tooltip>
        <!-- The autocommit/transaction segmented control from Console.html needs a per-console
             transaction-mode field that doesn't exist anywhere in tab or connection state —
             skipped rather than wiring a control with nowhere to store its value. -->
      <span class="ml-auto" />
      <Tooltip :disabled="true">
        <TooltipTrigger as-child>
          <span
            data-testid="run-state"
            class="inline-flex items-center gap-1 font-data text-kira-xs text-subtle"
            :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
          >
            <span data-testid="run-state-label" class="label min-w-[7ch] text-right">{{ runStateLabel }}</span
            ><span
              class="h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
              :class="{
                'animate-kira-spin border-t-primary border-r-transparent border-b-primary border-l-primary':
                  runState.status === 'running',
                'border-error': runState.status === 'error',
              }"
            />
          </span>
        </TooltipTrigger>
      </Tooltip>
      <div class="group"></div>
    </div>

    <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="console-error">
      <AlertDescription>{{ rt.error.message }}</AlertDescription>
    </Alert>
    <Alert v-if="formatError" variant="destructive" data-testid="console-format-error">
      <AlertDescription>{{ formatError }}</AlertDescription>
    </Alert>
    <Alert v-if="formatWarning" variant="warn" data-testid="console-format-warning">
      <AlertDescription>{{ formatWarning }}</AlertDescription>
    </Alert>
    <Alert v-if="formatNote" variant="note" data-testid="console-format-note">
      <AlertDescription>{{ formatNote }}</AlertDescription>
    </Alert>
    <Alert v-if="explainError" variant="destructive" data-testid="console-explain-error">
      <AlertDescription>{{ explainError }}</AlertDescription>
    </Alert>
    <!-- P18 D19: warns, never blocks — the query underneath this strip already ran (or is
         running). "Show plan" pushes the plan this strip already parsed, no second round trip. -->
    <Alert v-if="rt?.autoExplain" variant="warn" data-testid="console-auto-explain">
      <AlertDescription class="flex items-center gap-1.5">
        <span class="auto-explain-message">{{ autoExplainMessage }}</span>
        <button
          v-if="canShowAutoExplainPlan"
          type="button"
          class="auto-explain-action"
          data-testid="console-auto-explain-show-plan"
          @click="onShowAutoExplainPlan"
        >
          Show plan
        </button>
      </AlertDescription>
    </Alert>

      <!-- Item 4/2 (regression pass, task batch P46-3/4): every other gated view replaced its
           whole ViewChrome (header, toolbar and all) with the reconnect gate — item 4 fixed that
           inconsistency for them, and the console never had a Refresh button to carry the same
           reconnect-or-continue job, only Run/Run all (see runStatement/runAll above). With those
           two now reconnecting on demand, the console's own separate "Reconnect & load" gate had
           nothing left to gate — the editor already stayed visible behind it (item 2), and running
           a restored tab's query now reconnects itself, so the button was just a second, redundant
           way to do what pressing Run already does. Removed rather than kept as a no-op. -->
      <!-- P104: SplitterGroup wrapping the editor+results body and CellEditorDock.vue's own dock
           panel — the resize handle must sit as reka's own direct child alongside the panel it
           resizes (CellEditorDock.vue's own header comment). -->
      <SplitterGroup direction="vertical" class="console-split">
      <SplitterPanel class="console-split-top" :order="1">
      <div class="editor-body">
        <MonacoHost
          ref="editorHost"
          :doc="localDoc"
          :language="language"
          :sql-dialect="dialect"
          :read-only="false"
          :autocomplete="language !== 'plain'"
          :completion-sources="completionSources"
          :lint-source="lintSource"
          :hover-source="hoverSource"
          keep-selection-on-external-sync
          @update:doc="onDocChange"
          @update:cursor="cursorPos = $event"
        />
      </div>

      <div v-if="rt && rt.results.length > 0" class="results-body" data-testid="console-results">
        <!-- Console.html's own console body shows one result at a time behind a strip, rather
             than stacking every statement's page — D2. Each chip is a result *set*, addressed by
             its stable key (state.ts's resultPageKey/nextSeq), not by position, so closing one
             doesn't re-key its siblings. -->
        <div class="result-strip-row p-toolbar">
          <div
            ref="resultStripRef"
            class="result-strip"
            data-testid="console-result-strip"
            @wheel="onResultStripWheel"
          >
            <div
              v-for="(result, i) in rt.results"
              :key="result.key"
              class="p-tab result-tab"
              :class="{ 'is-active': result.key === rt.activeKey }"
              data-testid="console-result-tab"
              :data-active="result.key === rt.activeKey"
            >
              <!-- P105 §11: a focusable close control nested inside the tab's own <button> is
                   invalid HTML and unreachable by keyboard — the close button is this tab's
                   sibling now, not its child. -->
              <button
                type="button"
                class="result-tab-main"
                @click="consoleViewStore.setActiveResult(tab.id, result.key)"
                @auxclick.middle="onResultMiddleClick(result.key)"
                @contextmenu.prevent="onResultContextMenu($event, result.key, i)"
              >
                <CodiconIcon :name="iconForResult(result.key)" :size="13" class="result-tab-icon" />
                <span class="result-tab-title">Result {{ i + 1 }}</span>
              </button>
              <button
                type="button"
                class="result-close"
                aria-label="Close result"
                data-testid="console-result-close"
                @click="consoleViewStore.closeResult(tab.id, result.key)"
              >
                <CodiconIcon name="close" :size="11" />
              </button>
            </div>
          </div>
          <span class="text-kira-sm text-muted-foreground ml-auto" data-testid="console-status">{{ statusLine }}</span>
          <!-- Item (regression pass, task batch P46-4): only shown for a document-shaped (Mongo)
               result — DocumentView.vue's own expand-all/collapse-all pair, needed here now that
               a document row's only other way to reveal its full body (the cell editor dock) is
               gone as a redundant second copy of this same DocumentTree (P42 D11). -->
          <template v-if="activeResultIsDocument">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Expand all"
                  data-testid="console-expand-all"
                  @click="onExpandAllResults"
                >
                  <CodiconIcon name="expand-all" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Expand all</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Collapse all"
                  data-testid="console-collapse-all"
                  @click="onCollapseAllResults"
                >
                  <CodiconIcon name="collapse-all" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Collapse all</TooltipContent>
            </Tooltip>
          </template>
        </div>
        <SearchToolbar
          v-if="rt.searchOpen && !activeResultIsPlan"
          :tab-id="tab.id"
          testid-prefix="console-"
          row-noun="rows"
          :api="pageSearchApi"
          @go-to-match="onGoToMatch"
          @close="onCloseSearch"
        />
        <div class="result-grid">
          <!-- D17: a plan result set renders through its own view — reusing the strip/close/
               eviction machinery above, but never ConsoleResultGrid, which resolves a Page that a
               plan result set does not have. -->
          <ExplainResultView v-if="rt.activeKey && activeResultIsPlan" :page-key="rt.activeKey" />
          <ConsoleResultGrid
            v-else-if="rt.activeKey"
            ref="resultGridRef"
            :page-key="rt.activeKey"
            :tab-id="tab.id"
            :connection-id="tab.connectionId"
            :path="tab.path"
          />
        </div>
      </div>

      </SplitterPanel>
      <!-- P40 D11: a console result has no addressable row/table to write back to at all — a
           viewer, not an editor refusing this particular cell (F12/F13). -->
      <SplitterResizeHandle v-if="hasCellDock" class="cell-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />
      <CellEditorDock :tab-id="tab.id" :read-only="true" />
      </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.console-view {
  @apply h-full flex flex-col min-h-0;
}

/* P104: the SplitterGroup wrapping the editor+results body and CellEditorDock.vue's own dock
   panel — the vertical split (row-resize) that used to be CellEditorDock's own internal
   PanelSplitter. */
.console-split {
  @apply flex flex-1 min-h-0 flex-col;
}

.console-split-top {
  @apply flex flex-col min-h-0;
}

/* Reproduces PanelSplitter.vue's old `divider` prop line exactly (a centred inset box-shadow,
   cleared on hover/drag, --kira-focus fill taking over instead) — same pattern as
   DataView.vue/KeyValuePane.vue's own .cell-splitter. cell-editor.spec.ts polls this class's
   box-shadow. */
.cell-splitter {
  @apply shrink-0 h-1 cursor-row-resize bg-transparent hover:bg-focus data-[state='drag']:bg-focus;
  box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border);
}
.cell-splitter:hover,
.cell-splitter[data-state='drag'] {
  box-shadow: none;
}

.saved-anchor {
  @apply relative;
}

.auto-explain-message {
  @apply flex-1;
}

.auto-explain-action {
  @apply border-0 bg-none p-0 text-inherit underline cursor-pointer text-[length:inherit] shrink-0;
}

.editor-body {
  @apply flex-1 basis-2/5 min-h-0 border-b border-border;
}

/* P40 D7: flex:1 (not a fixed height) so the active result's grid always reaches the panel's
   bottom edge — DataView.vue's own .grid-area rule (F1: the fixed-height .result-panel this used
   to be left an empty band below the last row whenever a result had fewer rows than that height). */
.results-body {
  @apply flex-1 basis-3/5 min-h-0 flex flex-col;
}

/* One .p-tab chip per result set (P40 D3) — the same "chip with a nested close span" markup
   TabStrip.vue's own tab strip uses, since a result set *is* a tab in every way that matters
   here. The trailing status text keeps data-testid="console-status": the "N results" /
   "Running…" / "Cancelled" line the deleted .status-line bar used to own (D4, wording
   revised on the P46-2 regression pass — "result sets" read as a second, unrelated concept
   sitting right next to a strip of chips already called "results" everywhere else in the UI).
   P42 D6: a step smaller than the app's primary tabs (--kira-h-sm/--kira-t-xs vs. --kira-h-md/
   --kira-t-sm) — the only way a secondary, in-panel strip actually reads as secondary — and
   scrollable under the wheel once new-result-by-default (D5) means a working session accumulates
   chips. No .p-tab-rail: every result set in one console belongs to the same connection, so a
   colour rail here would carry no information the main tab strip's own rail doesn't already.
   Item 6: the status text used to sit *inside* the same scrolling flex row as the chips
   themselves, pushed via `ml-auto` to the far end of that row's *content* — once enough chips
   accumulated to overflow the strip, that end sat off past the visible edge, so the status text
   (the running/result-count readout) scrolled out of view along with the chips that pushed past
   it. Splitting the chips into their own scrollable child, sized to the *remaining* width by
   `flex: 1; min-width: 0`, keeps `.result-strip-row` itself unscrolled and exactly toolbar-width —
   `ml-auto`'s margin-left: auto now pushes within that fixed-width row, not the chips' own
   scrolling content, so the status text stays pinned in view no matter how many chips pile up. */
.result-strip-row {
  @apply gap-1;
}

.result-strip {
  @apply flex items-center flex-1 min-w-0 overflow-x-auto gap-1;
  scrollbar-width: none;
}

.result-strip::-webkit-scrollbar {
  @apply hidden;
}

.result-tab {
  @apply max-w-36 h-5.5 text-kira-xs;
}

.result-tab:hover:not(.is-active) {
  @apply bg-hover;
}

/* P105 §11: the tab's own click/select surface, a plain sibling <button> now rather than the
   whole chip — unstyled beyond filling the space .p-tab's own padding leaves it. */
.result-tab-main {
  @apply flex flex-1 min-w-0 items-center gap-1 border-0 bg-transparent p-0 cursor-pointer;
}

.result-tab-icon {
  @apply shrink-0;
}

.result-tab-title {
  @apply overflow-hidden text-ellipsis whitespace-nowrap min-w-0;
}

.result-close {
  @apply inline-flex items-center justify-center shrink-0 w-3.5 h-3.5 cursor-pointer rounded-kira-sm border-0 bg-transparent p-0 opacity-0;
}

.result-tab:hover .result-close,
.result-tab.is-active .result-close {
  @apply opacity-100;
}

.result-close:hover {
  @apply bg-hover;
}

.result-grid {
  @apply flex-1 min-h-0;
}
</style>
