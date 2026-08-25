<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import { splitSqlStatements, statementAtCursor } from '@shared/domain/sql-split';
import type { ConsoleTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { EditorLanguageId } from '../../editor/languages';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import AppButton from '../../theme/primitives/AppButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import CellEditorDock from '../shared/celleditor/CellEditorDock.vue';
import { sqlDialectFor } from '../shared/sqlIdent';
import ConsoleResultGrid from './ConsoleResultGrid.vue';
import ConsoleSavedMenu from './ConsoleSavedMenu.vue';
import { consoleCompletionSources } from './completion';
import { consoleLintSource } from './lint';
import { resultPageKey, run, runtime, setText, stop } from './state';

// MainView.vue keys this component by tab.id — same discipline as DefinitionView.vue/DataView.vue.
const props = defineProps<{ tab: ConsoleTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4's gate, copied literally from DefinitionView.vue.
const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');

const targetTail = computed(() => pathTail(props.tab.path));

const connectionKind = computed<ConnectionKind | undefined>(() => {
  if (!props.tab.connectionId) return undefined;
  return connectionsState.records.find((r) => r.id === props.tab.connectionId)?.kind;
});

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
// ConsoleSavedMenu.vue's promptInput/SearchToolbar.vue's own template ref.
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

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  unregisterCommands = [
    registerCommand('view.run', runStatement),
    registerCommand('view.run-all', runAll),
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
        <!-- Console.html's Result/Messages/Plan segmented switcher and per-statement text/SELECT
             badge assume one active result at a time; this view stacks every statement's page
             instead (no "which statement produced this" or verb metadata is tracked per page),
             so each panel keeps only what it actually has: its index and row count. -->
        <div v-for="(page, i) in rt.results" :key="i" class="result-panel">
          <div class="result-head">
            <span class="p-badge">Result {{ i + 1 }}</span>
            <span class="p-sm muted">{{ page.rowCount }} row{{ page.rowCount === 1 ? '' : 's' }}</span>
          </div>
          <div class="result-grid">
            <ConsoleResultGrid
              :page-key="resultPageKey(tab.id, i)"
              :tab-id="tab.id"
              :connection-id="tab.connectionId"
              :path="tab.path"
            />
          </div>
        </div>
      </div>

      <CellEditorDock :tab-id="tab.id" />
      <div class="status-line" data-testid="console-status">{{ statusLine }}</div>
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

.results-body {
  flex: 1 1 60%;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.result-panel {
  flex-shrink: 0;
  height: 260px;
  display: flex;
  flex-direction: column;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* Console.html's own result-head: h-md, s-4 padding, border on both edges, elevated background —
   not a shared primitive (the grid/kv/stream headers are p-thead), just this screen's chrome
   for the strip that labels each stacked result. */
.result-head {
  height: var(--kira-h-md);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-elevated);
}

.result-grid {
  flex: 1;
  min-height: 0;
}

/* D: "there is no editor status line" law folds this into the toolbar's run-state above; kept
   here (data-testid="console-status") only because it is still asserted on directly. */
.status-line {
  flex-shrink: 0;
  padding: 0 var(--kira-s-4);
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  line-height: var(--kira-h-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
