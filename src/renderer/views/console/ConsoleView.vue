<script setup lang="ts">
import { splitSqlStatements, statementAtCursor } from '@shared/domain/sql-split';
import type { ConsoleTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import ConsoleResultGrid from './ConsoleResultGrid.vue';
import ConsoleSavedMenu from './ConsoleSavedMenu.vue';
import { resultPageKey, run, runtime, setText, stop } from './state';

// MainView.vue keys this component by tab.id — same discipline as DdlView.vue/DataView.vue.
const props = defineProps<{ tab: ConsoleTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4's gate, copied literally from DdlView.vue.
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
const dialect = computed<'postgres' | 'mariadb' | undefined>(() => {
  if (!props.tab.connectionId) return undefined;
  const record = connectionsState.records.find((r) => r.id === props.tab.connectionId);
  return record?.kind === 'postgres' || record?.kind === 'mariadb' ? record.kind : undefined;
});

const cursorPos = ref(0);
const savedMenuOpen = ref(false);

function onDocChange(text: string): void {
  setText(props.tab.id, text);
}

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
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="console-reconnect">
      <button type="button" data-testid="console-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <div class="header">
        <span class="target" data-testid="console-target">{{
          targetTail?.name ?? tab.path ?? 'Console'
        }}</span>
        <div class="toolbar">
          <button
            type="button"
            data-testid="console-run-statement"
            :disabled="running"
            title="Run statement (the one under the cursor)"
            @click="runStatement"
          >
            <Codicon name="play" :size="13" />
            Run statement
          </button>
          <button
            type="button"
            data-testid="console-run-all"
            :disabled="running"
            title="Run all statements"
            @click="runAll"
          >
            <Codicon name="run-all" :size="13" />
            Run all
          </button>
          <button
            v-if="running"
            type="button"
            data-testid="console-stop"
            title="Stop"
            @click="onStop"
          >
            <Codicon name="debug-stop" :size="13" />
          </button>
          <button
            type="button"
            data-testid="console-saved-toggle"
            title="Saved queries"
            @click="savedMenuOpen = !savedMenuOpen"
          >
            <Codicon name="bookmark" :size="13" />
          </button>
        </div>
      </div>

      <ConsoleSavedMenu v-if="savedMenuOpen" :tab-id="tab.id" @close="savedMenuOpen = false" />

      <div v-if="rt?.status === 'error' && rt.error" class="error-strip" data-testid="console-error">
        {{ rt.error.message }}
      </div>

      <div class="editor-body">
        <CodeMirrorHost
          :doc="tab.state.text"
          language="sql"
          :sql-dialect="dialect"
          :read-only="false"
          @update:doc="onDocChange"
          @update:cursor="cursorPos = $event"
        />
      </div>

      <div v-if="rt && rt.results.length > 0" class="results-body" data-testid="console-results">
        <div v-for="(page, i) in rt.results" :key="i" class="result-panel">
          <div class="result-label">Result {{ i + 1 }} · {{ page.rowCount }} row{{ page.rowCount === 1 ? '' : 's' }}</div>
          <div class="result-grid">
            <ConsoleResultGrid :page-key="resultPageKey(tab.id, i)" />
          </div>
        </div>
      </div>

      <div class="status-line" data-testid="console-status">{{ statusLine }}</div>
    </template>
  </div>
</template>

<style scoped>
.console-view {
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

.reconnect-panel button {
  padding: 6px 14px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.reconnect-panel button:hover {
  background: var(--kira-hover);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  font-size: 11px;
  flex-shrink: 0;
  overflow: hidden;
}

.target {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kira-fg);
  font-weight: 600;
  min-width: 0;
}

.toolbar {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.toolbar button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 11px;
}

.toolbar button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.toolbar button:disabled {
  opacity: 0.5;
  cursor: default;
}

.error-strip {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--kira-font-family);
  color: var(--kira-error);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  white-space: pre-wrap;
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

.result-label {
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 10px;
  color: var(--kira-fg-muted);
  background: var(--kira-bg-elevated);
}

.result-grid {
  flex: 1;
  min-height: 0;
}

.status-line {
  flex-shrink: 0;
  padding: 3px 8px;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
