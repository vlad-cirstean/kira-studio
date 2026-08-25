<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import { splitSqlStatements, statementAtCursor } from '@shared/domain/sql-split';
import type { ConsoleTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { registerCommand } from '../../shortcuts/commands';
import { connectionRecord } from '../../state/connections';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import SearchToolbar from '../shared/page/SearchToolbar.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import { useConnectionGate } from '../shared/useConnectionGate';
import ConsoleResultGrid from './ConsoleResultGrid.vue';
import ConsoleSavedMenu from './ConsoleSavedMenu.vue';
import { consoleCompletionSources } from './completion';
import { consoleLintSource } from './lint';
import { type Match, pageSearchApi } from './search';
import {
  closeResult,
  run,
  runtime,
  setActiveResult,
  setNewResultSet,
  setText,
  stop,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DataView.vue.
const props = defineProps<{ tab: ConsoleTabRecord }>();

// A console tab hydrates without loading anything (there is nothing to load until a statement
// runs), so no onLoad is passed.
const { connectionStatus, needsReconnect, onReconnectAndLoad } = useConnectionGate(() => props.tab);

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

// D21/D22: undefined for postgres/mariadb/mysql (lang-sql's own keyword source stays in charge) and for
// any kind with no console at all, which a mounted ConsoleView never actually has (caps.sql
// gates the tab) — `language.value !== 'plain'` covers both without special-casing kafka/sqs/s3.
const completionSources = computed(() => {
  if (!connectionKind.value || language.value === 'plain' || language.value === 'sql') {
    return undefined;
  }
  return consoleCompletionSources(connectionKind.value, props.tab.connectionId, props.tab.path);
});

// D24: one lexical linter per engine, scoped to this console's own text — undefined for any tab
// this view never actually mounts for (caps.sql gates the tab), so `connectionKind.value` is
// always postgres/mariadb/mysql/mongodb/redis in practice.
const lintSource = computed(() => consoleLintSource(connectionKind.value));

const cursorPos = ref(0);
const savedMenuOpen = ref(false);
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
}

watch(
  () => props.tab.state.text,
  (text) => {
    if (text === lastEmitted) return;
    localDoc.value = text;
  },
);

function runStatement(): void {
  const stmt = statementAtCursor(props.tab.state.text, cursorPos.value);
  if (!stmt) return;
  void run(props.tab.id, [stmt.text]);
}

function runAll(): void {
  const statements = splitSqlStatements(props.tab.state.text).map((s) => s.text);
  if (statements.length === 0) return;
  void run(props.tab.id, statements);
}

function onStop(): void {
  stop(props.tab.id);
}

// --- search: the shared find toolbar over the active result set (P40 D8/D9). Mirrors
// KeyValueView.vue's own onToggleSearch/onCloseSearch discipline exactly. -----------------------
function onToggleSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = !r.searchOpen;
}
function onCloseSearch(): void {
  const r = rt.value;
  if (r) r.searchOpen = false;
}

const resultGridRef = ref<{ goToMatch: (match: Match) => void } | null>(null);
function onGoToMatch(match: Match): void {
  resultGridRef.value?.goToMatch(match);
}

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  unregisterCommands = [
    registerCommand('view.run', runStatement),
    registerCommand('view.run-all', runAll),
    registerCommand('view.find', onToggleSearch),
  ];
});

onUnmounted(() => {
  for (const off of unregisterCommands) off();
});

const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  if (r.status === 'running') return 'Running…';
  if (r.status === 'cancelled') return 'Cancelled';
  if (r.status === 'idle' && r.results.length > 0) {
    return `${r.results.length} result set${r.results.length === 1 ? '' : 's'}`;
  }
  return '';
});
</script>

<template>
  <div class="console-view" data-testid="console-view" :data-path="tab.path">
    <ReconnectGate
      v-if="needsReconnect"
      container-testid="console-reconnect"
      button-testid="console-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      icon="terminal"
      :name="targetTail?.name ?? tab.path ?? 'Console'"
      target-testid="console-target"
      stop-testid="console-stop"
      :can-refresh="false"
      :can-stop="running"
      @stop="onStop"
    >
      <!-- The console's search_path/schema control and the "writes go to production" chip from
           Console.html both need tracked data this app does not have yet (no per-console
           schema, no per-connection write-warning flag) — skipped rather than faked. Refresh is
           permanently disabled here (reserved slot, same as the definition view's Stop): Run/Run all are
           the console's two start verbs, and neither one is "refresh". -->
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
        <div class="sep"></div>
        <!-- P40 D6, default flipped P42 D5: append a new result set instead of replacing the
             current ones. On by default and per-tab; clicking it off is what makes a run replace
             the active result set instead, for someone who wants to keep re-running one query. -->
        <IconButton
          icon="layers"
          :active="!!tab.state.newResultSet"
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
      </template>

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
          @update:doc="onDocChange"
          @update:cursor="cursorPos = $event"
        />
      </div>

      <div v-if="rt && rt.results.length > 0" class="results-body" data-testid="console-results">
        <!-- Console.html's own console body shows one result at a time behind a strip, rather
             than stacking every statement's page — D2. Each chip is a result *set*, addressed by
             its stable key (state.ts's resultPageKey/nextSeq), not by position, so closing one
             doesn't re-key its siblings. -->
        <div class="result-strip p-toolbar" data-testid="console-result-strip">
          <button
            v-for="(result, i) in rt.results"
            :key="result.key"
            type="button"
            class="p-tab"
            :class="{ 'is-active': result.key === rt.activeKey }"
            data-testid="console-result-tab"
            :data-active="result.key === rt.activeKey"
            @click="setActiveResult(tab.id, result.key)"
          >
            Result {{ i + 1 }}
            <span
              class="result-close"
              role="button"
              aria-label="Close result"
              data-testid="console-result-close"
              @click.stop="closeResult(tab.id, result.key)"
            >
              <CodiconIcon name="close" :size="13" />
            </span>
          </button>
          <span class="p-sm muted p-push" data-testid="console-status">{{ statusLine }}</span>
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
   here. The trailing status text keeps data-testid="console-status": the "N result sets" /
   "Running…" / "Cancelled" line the deleted .status-line bar used to own (D4). */
.result-strip {
  gap: var(--kira-s-2);
}

.result-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kira-radius-sm);
}

.result-close:hover {
  background: var(--kira-hover);
}

.result-grid {
  flex: 1;
  min-height: 0;
}
</style>
