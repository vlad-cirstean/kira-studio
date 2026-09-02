<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import { splitSqlStatements, statementAtCursor } from '@shared/domain/sql-split';
import type { ConsoleTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { dialectObjectFor } from '../../editor/languages';
import { registerCommand } from '../../shortcuts/commands';
import { connectionRecord } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { ddlSchemaFor, ensureDdl } from '../../state/schemas';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import { wheelToHorizontal } from '../../wheelScroll';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { backslashEscapesFor, sqlDialectFor } from '../shared/sqlIdent';
import { useConnectionGate } from '../shared/useConnectionGate';
import ConsoleResultGrid from './ConsoleResultGrid.vue';
import ConsoleSavedMenu from './ConsoleSavedMenu.vue';
import { consoleCompletionSources } from './completion';
import { canFormatConsole, formatConsoleText } from './format';
import { consoleLintSource } from './lint';
import { getPage } from './resultPages';
import { type Match, pageSearchApi } from './search';
import { sqlHoverSource } from './sqlHover';
import {
  closeOtherResults,
  closeResult,
  closeResultsToTheRight,
  run,
  runtime,
  setActiveResult,
  setNewResultSet,
  setSearchOpen,
  setText,
  stop,
  toggleSearchOpen,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DataView.vue.
const props = defineProps<{ tab: ConsoleTabRecord }>();

// A console tab hydrates without loading anything (there is nothing to load until a statement
// runs), so no onLoad is passed.
const { needsReconnect, onReconnectAndLoad } = useConnectionGate(() => props.tab);

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');

const targetTail = computed(() => pathTail(props.tab.path));

const connectionKind = computed<ConnectionKind | undefined>(
  () => connectionRecord(props.tab.connectionId)?.kind,
);

const dialect = computed(() => sqlDialectFor(connectionKind.value));

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
// (a non-SQL console) never fires the load at all.
watch(
  () => [props.tab.connectionId, dialect.value] as const,
  ([connectionId, d]) => {
    if (connectionId && d) void ensureDdl(connectionId);
  },
  { immediate: true },
);
const ddlSchema = computed(() => ddlSchemaFor(props.tab.connectionId ?? '', dialect.value));

// D21/D22: undefined for any kind with no console at all, which a mounted ConsoleView never
// actually has (caps.sql gates the tab) — `language.value !== 'plain'` covers that without
// special-casing kafka/sqs/s3. The SQL branch (D5) is undefined with no DDL document for this
// connection — lang-sql's own keyword source stays in charge, byte-for-byte today's behaviour.
const completionSources = computed(() => {
  if (!connectionKind.value || language.value === 'plain') return undefined;
  if (language.value === 'sql') {
    return consoleCompletionSources(
      connectionKind.value,
      props.tab.connectionId,
      props.tab.path,
      ddlSchema.value,
      connectionRecord(props.tab.connectionId)?.database,
    );
  }
  return consoleCompletionSources(connectionKind.value, props.tab.connectionId, props.tab.path);
});

// D24: one lexical linter per engine, scoped to this console's own text — undefined for any tab
// this view never actually mounts for (caps.sql gates the tab), so `connectionKind.value` is
// always postgres/mariadb/mysql/mongodb/redis in practice.
const lintSource = computed(() => consoleLintSource(connectionKind.value, ddlSchema.value));

// C6/D8: undefined with no DDL document (D5) or a non-SQL kind — CodeMirrorHost's own hoverSource
// prop is additive, so every other console stays exactly as it was.
const hoverSource = computed(() => {
  const dialectObject = dialect.value && dialectObjectFor(dialect.value);
  if (!dialectObject) return undefined;
  return sqlHoverSource(dialectObject, ddlSchema.value);
});

const cursorPos = ref(0);
const savedMenuOpen = ref(false);
// D9: the console runtime has no actionError field (rt.status === 'error' means the last *run*
// failed, F11) — a format failure is a client-side text operation with nowhere else to go, so it
// gets its own component-local strip instead of a runtime-shape change.
const formatError = ref<string | null>(null);
const canFormat = computed(() => canFormatConsole(connectionKind.value));
// Typed as the bare exposed shape (rather than InstanceType<typeof CodeMirrorHost>) so this ref
// doesn't read as a type-only use of the CodeMirrorHost import — same convention as
// ConsoleSavedMenu.vue's promptInput/views/shared/page/SearchToolbar.vue's own template ref.
const editorHost = ref<{ focus: () => void } | null>(null);
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
// CodeMirrorHost's own equality-guarded `doc` watcher didn't already provide. `lastEmitted` is a
// plain variable, not a ref — comparing against it is what lets an external write (a saved-query
// load, tab hydration) still reach the editor while a self-triggered echo does not.
const localDoc = shallowRef(props.tab.state.text);
let lastEmitted = props.tab.state.text;

function onDocChange(text: string): void {
  lastEmitted = text;
  setText(props.tab.id, text);
  formatError.value = null;
}

watch(
  () => props.tab.state.text,
  (text) => {
    if (text === lastEmitted) return;
    localDoc.value = text;
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
  const stmt = statementAtCursor(props.tab.state.text, cursorPos.value, {
    backslashEscapes: backslashEscapesFor(dialect.value),
  });
  if (!stmt) return;
  void (async () => {
    await ensureConnectedForRun();
    await run(props.tab.id, [stmt.text]);
  })();
}

function runAll(): void {
  const statements = splitSqlStatements(props.tab.state.text, {
    backslashEscapes: backslashEscapesFor(dialect.value),
  }).map((s) => s.text);
  if (statements.length === 0) return;
  void (async () => {
    await ensureConnectedForRun();
    await run(props.tab.id, statements);
  })();
}

function onStop(): void {
  stop(props.tab.id);
}

function onFormat(): void {
  const kind = connectionKind.value;
  if (!kind || !canFormat.value) return;
  void (async () => {
    const result = await formatConsoleText(kind, props.tab.state.text);
    if (result.ok) {
      formatError.value = null;
      setText(props.tab.id, result.text);
    } else {
      formatError.value = result.reason ?? 'could not format this query';
    }
  })();
}

// --- search: the shared find toolbar over the active result set (P40 D8/D9). Mirrors
// KeyValueView.vue's own onToggleSearch/onCloseSearch discipline exactly. -----------------------
function onToggleSearch(): void {
  toggleSearchOpen(props.tab.id);
}
function onCloseSearch(): void {
  setSearchOpen(props.tab.id, false);
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
function iconForResult(key: string): string {
  return RESULT_KIND_ICON[getPage(key)?.kind ?? ''] ?? 'table';
}

function onResultMiddleClick(key: string): void {
  closeResult(props.tab.id, key);
}

// P42 D8: the same three items TabStrip.vue's own tab row leads with, over one tab's result sets
// instead of the app's whole tab list — disabled rather than hidden when they would be a no-op.
function onResultContextMenu(e: MouseEvent, key: string, index: number): void {
  const total = rt.value?.results.length ?? 0;
  openContextMenu(e, [
    {
      type: 'item',
      id: 'close',
      label: 'Close',
      icon: 'close',
      run: () => closeResult(props.tab.id, key),
    },
    {
      type: 'item',
      id: 'close-other-results',
      label: 'Close others',
      disabled: total <= 1,
      run: () => closeOtherResults(props.tab.id, key),
    },
    {
      type: 'item',
      id: 'close-results-to-the-right',
      label: 'Close to the right',
      disabled: index >= total - 1,
      run: () => closeResultsToTheRight(props.tab.id, key),
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
    <ViewChrome
      :tab="tab"
      icon="terminal"
      :name="targetTail?.name ?? tab.path ?? 'Console'"
      target-testid="console-target"
      refresh-testid="console-refresh"
      stop-testid="console-stop"
      :can-refresh="needsReconnect"
      :can-stop="running"
      @refresh="onReconnectAndLoad"
      @stop="onStop"
    >
      <!-- The console's search_path/schema control and the "writes go to production" chip from
           Console.html both need tracked data this app does not have yet (no per-console
           schema, no per-connection write-warning flag) — skipped rather than faked. Refresh
           itself still isn't a third start verb (Run/Run all cover that, and now reconnect on
           their own — see runStatement/runAll above): it stays disabled whenever there's nothing
           to reconnect, and is only ever the reconnect trigger while gated, so it's never a dead,
           permanently-grey button sitting in the rail for no reason a user can see. -->
      <template #toolbar>
        <AppButton
          icon="play"
          variant="primary"
          data-testid="console-run-statement"
          :disabled="running"
          v-tooltip="'Run the statement under the cursor'"
          @click="runStatement"
        >
          Run
        </AppButton>
        <AppButton
          icon="run-all"
          data-testid="console-run-all"
          :disabled="running"
          v-tooltip="'Run every statement in the editor'"
          @click="runAll"
        >
          Run all
        </AppButton>
        <AppButton
          v-if="canFormat"
          icon="indent"
          data-testid="console-format"
          :disabled="!tab.state.text.trim()"
          v-tooltip="'Format the query text'"
          @click="onFormat"
        >
          Format
        </AppButton>
        <div class="sep"></div>
        <!-- P40 D6, default re-flipped back on P46-2: append a new result set instead of replacing
             the current ones. On (appending) by default and per-tab, shown unpressed — pressing
             this is what makes a run replace the last result set instead of stacking a new one,
             so the pressed/"active" look tracks *replace* mode, the inverse of the stored flag. -->
        <IconButton
          icon="layers"
          :active="!tab.state.newResultSet"
          data-testid="console-new-result-toggle"
          v-tooltip="
            tab.state.newResultSet
              ? 'Running adds a new result set — click to replace instead'
              : 'Running replaces the current result sets — click to add a new one instead'
          "
          @click="setNewResultSet(tab.id, !tab.state.newResultSet)"
        />
        <div class="sep"></div>
        <div class="saved-anchor">
          <AppButton
            icon="bookmark"
            data-testid="console-saved-toggle"
            v-tooltip="'Saved queries'"
            @click="savedMenuOpen = !savedMenuOpen"
          >
            Saved queries
          </AppButton>
          <!-- PopoverPanel.vue anchors itself to its own DOM parent (see its own comment) — this menu
               used to render several levels away from its trigger button (a direct child of
               ViewChrome's default slot, down by .editor-body), so it opened pinned to a corner
               of the window instead of under "Saved queries" (task #58). Wrapping it here next to
               its button, the same shape every other toolbar menu already uses, fixes that. -->
          <ConsoleSavedMenu v-if="savedMenuOpen" :tab-id="tab.id" @close="onSavedMenuClose" />
        </div>
        <div class="sep"></div>
        <IconButton
          icon="search"
          :active="!!rt?.searchOpen"
          v-tooltip="'Find in the active result set'"
          data-testid="console-search"
          @click="onToggleSearch"
        />
        <!-- The autocommit/transaction segmented control from Console.html needs a per-console
             transaction-mode field that doesn't exist anywhere in tab or connection state —
             skipped rather than wiring a control with nowhere to store its value. -->
      </template>

      <template #strips>
        <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="console-error">
          {{ rt.error.message }}
        </MessageStrip>
        <MessageStrip v-if="formatError" tone="err" data-testid="console-format-error">
          {{ formatError }}
        </MessageStrip>
      </template>

      <!-- Item 4/2 (regression pass, task batch P46-3/4): every other gated view replaced its
           whole ViewChrome (header, toolbar and all) with the reconnect gate — item 4 fixed that
           inconsistency for them, and the console never had a Refresh button to carry the same
           reconnect-or-continue job, only Run/Run all (see runStatement/runAll above). With those
           two now reconnecting on demand, the console's own separate "Reconnect & load" gate had
           nothing left to gate — the editor already stayed visible behind it (item 2), and running
           a restored tab's query now reconnects itself, so the button was just a second, redundant
           way to do what pressing Run already does. Removed rather than kept as a no-op. -->
      <div class="editor-body">
        <CodeMirrorHost
          ref="editorHost"
          :doc="localDoc"
          :language="language"
          :sql-dialect="dialect"
          :read-only="false"
          :autocomplete="language !== 'plain'"
          :completion-sources="completionSources"
          :lint-source="lintSource"
          :hover-source="hoverSource"
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
            <button
              v-for="(result, i) in rt.results"
              :key="result.key"
              type="button"
              class="p-tab result-tab"
              :class="{ 'is-active': result.key === rt.activeKey }"
              data-testid="console-result-tab"
              :data-active="result.key === rt.activeKey"
              @click="setActiveResult(tab.id, result.key)"
              @auxclick.middle="onResultMiddleClick(result.key)"
              @contextmenu.prevent="onResultContextMenu($event, result.key, i)"
            >
              <CodiconIcon :name="iconForResult(result.key)" :size="13" class="result-tab-icon" />
              <span class="result-tab-title">Result {{ i + 1 }}</span>
              <span
                class="result-close"
                role="button"
                aria-label="Close result"
                data-testid="console-result-close"
                @click.stop="closeResult(tab.id, result.key)"
              >
                <CodiconIcon name="close" :size="11" />
              </span>
            </button>
          </div>
          <span class="p-sm muted p-push" data-testid="console-status">{{ statusLine }}</span>
          <!-- Item (regression pass, task batch P46-4): only shown for a document-shaped (Mongo)
               result — DocumentView.vue's own expand-all/collapse-all pair, needed here now that
               a document row's only other way to reveal its full body (the cell editor dock) is
               gone as a redundant second copy of this same DocumentTree (P42 D11). -->
          <template v-if="activeResultIsDocument">
            <IconButton
              icon="expand-all"
              v-tooltip="'Expand all'"
              data-testid="console-expand-all"
              @click="onExpandAllResults"
            />
            <IconButton
              icon="collapse-all"
              v-tooltip="'Collapse all'"
              data-testid="console-collapse-all"
              @click="onCollapseAllResults"
            />
          </template>
        </div>
        <SearchToolbar
          v-if="rt.searchOpen"
          :tab-id="tab.id"
          testid-prefix="console-"
          row-noun="rows"
          :api="pageSearchApi"
          @go-to-match="onGoToMatch"
          @close="onCloseSearch"
        />
        <div class="result-grid">
          <ConsoleResultGrid
            v-if="rt.activeKey"
            ref="resultGridRef"
            :page-key="rt.activeKey"
            :tab-id="tab.id"
            :connection-id="tab.connectionId"
            :path="tab.path"
          />
        </div>
      </div>

      <!-- P40 D11: a console result has no addressable row/table to write back to at all — a
           viewer, not an editor refusing this particular cell (F12/F13). -->
      <CellEditorDock :tab-id="tab.id" :read-only="true" />
    </ViewChrome>
  </div>
</template>

<style scoped>
.console-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.saved-anchor {
  position: relative;
}

/* p-strip.err already carries the error's own look; only the parent's error message text needs
   pre-wrap so a long adapter error still wraps instead of scrolling. */
.p-strip.err {
  white-space: pre-wrap;
  font-family: var(--kira-font-family);
}

.editor-body {
  flex: 1 1 40%;
  min-height: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* P40 D7: flex:1 (not a fixed height) so the active result's grid always reaches the panel's
   bottom edge — DataView.vue's own .grid-area rule (F1: the fixed-height .result-panel this used
   to be left an empty band below the last row whenever a result had fewer rows than that height). */
.results-body {
  flex: 1 1 60%;
  min-height: 0;
  display: flex;
  flex-direction: column;
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
   themselves, `.p-push`ed to the far end of that row's *content* — once enough chips
   accumulated to overflow the strip, that end sat off past the visible edge, so the status text
   (the running/result-count readout) scrolled out of view along with the chips that pushed past
   it. Splitting the chips into their own scrollable child, sized to the *remaining* width by
   `flex: 1; min-width: 0`, keeps `.result-strip-row` itself unscrolled and exactly toolbar-width —
   `.p-push`'s margin-left: auto now pushes within that fixed-width row, not the chips' own
   scrolling content, so the status text stays pinned in view no matter how many chips pile up. */
.result-strip-row {
  gap: var(--kira-s-2);
}

.result-strip {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.result-strip::-webkit-scrollbar {
  display: none;
}

.result-tab {
  height: var(--kira-h-sm);
  font-size: var(--kira-t-xs);
  max-width: 140px;
}

.result-tab:hover:not(.is-active) {
  background: var(--kira-hover);
}

.result-tab-icon {
  flex-shrink: 0;
}

.result-tab-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.result-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: var(--kira-radius-sm);
  opacity: 0;
}

.result-tab:hover .result-close,
.result-tab.is-active .result-close {
  opacity: 1;
}

.result-close:hover {
  background: var(--kira-hover);
}

.result-grid {
  flex: 1;
  min-height: 0;
}
</style>
