<script setup lang="ts">
import type { StreamTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import { goNext, load, poll, reload, runCount, runtime, stop } from './state';
import { streamMenu } from './streamMenu';
import { getPage, pageVersion, streamRow } from './streamPage';

// MainView.vue keys this component by tab.id — same discipline as KeyValueView.vue.
const props = defineProps<{ tab: StreamTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

const caps = computed(() => {
  const connectionId = props.tab.connectionId;
  return connectionId ? (connectionsState.states[connectionId]?.caps ?? null) : null;
});

// D10/D12: SQS's 'batch' pagination is never auto-loaded — the user must click Poll, because
// every poll consumes messages from the queue (subject to VisibilityTimeout) rather than
// merely browsing them. Kafka's 'offsetWindow' strategy is a pure browse and auto-loads like
// every other read-only view.
const isBatch = computed(() => caps.value?.pagination === 'batch');

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  if (!isBatch.value) await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id);
});

const rowIndices = computed(() => {
  void pageVersion.n;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return streamRow(props.tab.id, i);
}

function onRowContextMenu(e: MouseEvent, key: string | null, body: string): void {
  e.preventDefault();
  openContextMenu(e, streamMenu(key, body));
}

function onStop(): void {
  stop(props.tab.id);
}

function onPoll(): void {
  void poll(props.tab.id);
}

const statusLine = computed(() => {
  const r = rt.value;
  if (!r) return '';
  const parts: string[] = [];
  parts.push(`${r.rowCount} row${r.rowCount === 1 ? '' : 's'} on this page`);
  if (r.count) {
    parts.push(`${r.count.exact ? '' : '~'}${r.count.value.toLocaleString()} total`);
  }
  return parts.join(' · ');
});

let unregisterCommand: (() => void) | null = null;

onMounted(() => {
  if (!needsReconnect.value && !isBatch.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
});

onUnmounted(() => {
  unregisterCommand?.();
});
</script>

<template>
  <div class="stream-view" data-testid="stream-view" :data-path="tab.path">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="stream-reconnect">
      <button type="button" data-testid="stream-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <div class="header">
        <span class="target" data-testid="stream-target">{{ targetTail?.name ?? tab.path }}</span>
        <div class="meta" v-if="page?.visibilityTimeoutSeconds !== null && page?.visibilityTimeoutSeconds !== undefined">
          <span class="badge" data-testid="stream-visibility-timeout"
            >visibility: {{ page.visibilityTimeoutSeconds }}s</span
          >
        </div>
        <div class="toolbar">
          <button type="button" data-testid="stream-refresh" title="Refresh" @click="reload(tab.id)">
            <Codicon name="refresh" :size="13" />
          </button>
          <button type="button" data-testid="stream-count" title="Count" @click="runCount(tab.id)">
            <Codicon name="symbol-number" :size="13" />
          </button>
          <button
            v-if="isBatch"
            type="button"
            data-testid="stream-poll"
            title="Poll for messages"
            @click="onPoll"
          >
            <Codicon name="arrow-swap" :size="13" />
            Poll
          </button>
          <button
            v-else
            type="button"
            data-testid="stream-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          >
            <Codicon name="arrow-right" :size="13" />
          </button>
          <button v-if="running" type="button" data-testid="stream-stop" title="Stop" @click="onStop">
            <Codicon name="debug-stop" :size="13" />
          </button>
        </div>
      </div>

      <div v-if="isBatch" class="warn-strip" data-testid="stream-poll-warning">
        Each poll consumes messages from the queue (subject to the visibility timeout above) — it
        does not browse a stable position.
      </div>

      <div v-if="rt?.status === 'loading'" class="loading-bar" data-testid="stream-loading" />
      <div v-if="rt?.status === 'error' && rt.error" class="error-strip" data-testid="stream-error">
        {{ rt.error.message }}
      </div>

      <div class="list-body" data-testid="stream-list">
        <div v-if="isBatch && !rt?.polled" class="no-rows">Click Poll to fetch messages</div>
        <div v-else-if="!rt || rt.rowCount === 0" class="no-rows">{{ rt ? 'No messages' : '' }}</div>
        <table v-else class="stream-table">
          <thead>
            <tr>
              <th>key</th>
              <th>timestamp</th>
              <th>headers</th>
              <th>attrs</th>
              <th>body</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in rowIndices"
              :key="i"
              class="stream-row"
              data-testid="stream-row"
              @contextmenu="onRowContextMenu($event, rowAt(i)?.key ?? null, rowAt(i)?.body ?? '')"
            >
              <td class="stream-key" data-testid="stream-key">{{ rowAt(i)?.key ?? '(none)' }}</td>
              <td class="stream-timestamp" data-testid="stream-timestamp">{{ rowAt(i)?.timestamp ?? '' }}</td>
              <td class="stream-headers" data-testid="stream-headers">{{ rowAt(i)?.headers }}</td>
              <td class="stream-attrs" data-testid="stream-attrs">{{ rowAt(i)?.attrs }}</td>
              <td class="stream-body" data-testid="stream-body">
                {{ rowAt(i)?.body }}
                <span v-if="rowAt(i)?.isTruncated" class="truncated-marker" title="body truncated"
                  >(truncated)</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="status-line" data-testid="stream-status">{{ statusLine }}</div>
    </template>
  </div>
</template>

<style scoped>
.stream-view {
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

.meta {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.badge {
  padding: 1px 6px;
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  font-size: 10px;
  white-space: nowrap;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.toolbar button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: var(--kira-radius-sm);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
}

.toolbar button:hover:not(:disabled) {
  background: var(--kira-hover);
}

.toolbar button:disabled {
  opacity: 0.5;
  cursor: default;
}

.warn-strip {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--kira-font-family);
  color: var(--kira-fg-muted);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.loading-bar {
  height: 2px;
  flex-shrink: 0;
  background: linear-gradient(90deg, transparent, var(--kira-accent), transparent);
  background-size: 200% 100%;
  animation: loading-sweep 1.2s linear infinite;
}

@keyframes loading-sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
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

.list-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.no-rows {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--kira-fg-muted);
  font-size: 12px;
}

.stream-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--kira-font-family);
  font-size: 11px;
}

.stream-table thead th {
  position: sticky;
  top: 0;
  text-align: left;
  padding: 4px 8px;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  font-weight: 600;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.stream-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.stream-key,
.stream-timestamp,
.stream-headers,
.stream-attrs {
  padding: 4px 8px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
  vertical-align: top;
}

.stream-body {
  padding: 4px 8px;
  color: var(--kira-fg);
  white-space: pre-wrap;
  word-break: break-word;
}

.truncated-marker {
  padding-left: 6px;
  font-size: 10px;
  color: var(--kira-fg-muted);
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
