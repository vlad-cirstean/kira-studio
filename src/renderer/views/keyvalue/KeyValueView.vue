<script setup lang="ts">
import type { KeyValueTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import { openContextMenu } from '../../workbench/state/contextMenu';
import { keyValueMenu } from './keyValueMenu';
import { getPage, keyValueRow, pageVersion } from './kvPage';
import { goNext, goPrev, load, reload, runCount, runtime, stop } from './state';

// MainView.vue keys this component by tab.id — same discipline as DdlView.vue/DocumentView.vue.
const props = defineProps<{ tab: KeyValueTabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'loading');

const targetTail = computed(() => pathTail(props.tab.path));

const page = computed(() => {
  void pageVersion.n;
  return getPage(props.tab.id);
});

// A cursor-strategy page (hash/set/zset/stream — SCAN-family) is forward-only: there is no
// reliable way to seek a SCAN cursor backward, so "Prev" only ever applies to a list key's plain
// LRANGE offset strategy.
const prevDisabled = computed(
  () => props.tab.state.pageIndex === 0 || page.value?.position.strategy !== 'offset',
);

const rowIndices = computed(() => {
  void pageVersion.n;
  return Array.from({ length: rt.value?.rowCount ?? 0 }, (_, i) => i);
});

function rowAt(i: number) {
  void pageVersion.n;
  return keyValueRow(props.tab.id, i);
}

function ttlText(ttlMs: number | null): string {
  if (ttlMs === null) return 'no expiry';
  const seconds = Math.ceil(ttlMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.ceil(seconds / 3600)}h`;
}

function memoryText(bytes: number | null): string {
  if (bytes === null) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function onRowContextMenu(e: MouseEvent, field: string, value: string): void {
  e.preventDefault();
  openContextMenu(e, keyValueMenu(field, value));
}

function onStop(): void {
  stop(props.tab.id);
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
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  unregisterCommand = registerCommand('view.refresh', () => void reload(props.tab.id));
});

onUnmounted(() => {
  unregisterCommand?.();
});
</script>

<template>
  <div class="keyvalue-view" data-testid="keyvalue-view" :data-path="tab.path">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="keyvalue-reconnect">
      <button type="button" data-testid="keyvalue-reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <div class="header">
        <span class="target" data-testid="keyvalue-target">{{ targetTail?.name ?? tab.path }}</span>
        <div class="meta" v-if="page">
          <span class="badge" data-testid="keyvalue-type">{{ page.redisType }}</span>
          <span class="badge" data-testid="keyvalue-ttl">TTL: {{ ttlText(page.ttlMs) }}</span>
          <span class="badge" data-testid="keyvalue-memory">{{ memoryText(page.memoryBytes) }}</span>
        </div>
        <div class="toolbar">
          <button type="button" data-testid="keyvalue-refresh" title="Refresh" @click="reload(tab.id)">
            <Codicon name="refresh" :size="13" />
          </button>
          <button type="button" data-testid="keyvalue-count" title="Exact count" @click="runCount(tab.id)">
            <Codicon name="symbol-number" :size="13" />
          </button>
          <button
            type="button"
            data-testid="keyvalue-prev"
            :disabled="prevDisabled"
            title="Previous page"
            @click="goPrev(tab.id)"
          >
            <Codicon name="arrow-left" :size="13" />
          </button>
          <button
            type="button"
            data-testid="keyvalue-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          >
            <Codicon name="arrow-right" :size="13" />
          </button>
          <button v-if="running" type="button" data-testid="keyvalue-stop" title="Stop" @click="onStop">
            <Codicon name="debug-stop" :size="13" />
          </button>
        </div>
      </div>

      <div v-if="rt?.status === 'loading'" class="loading-bar" data-testid="keyvalue-loading" />
      <div v-if="rt?.status === 'error' && rt.error" class="error-strip" data-testid="keyvalue-error">
        {{ rt.error.message }}
      </div>

      <div class="list-body" data-testid="keyvalue-list">
        <div v-if="!rt || rt.rowCount === 0" class="no-rows">{{ rt ? 'No data' : '' }}</div>
        <table v-else class="kv-table">
          <thead>
            <tr>
              <th>{{ page?.redisType === 'string' ? '' : page?.redisType === 'list' ? 'index' : 'field' }}</th>
              <th>{{ page?.redisType === 'zset' ? 'score' : 'value' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="i in rowIndices"
              :key="i"
              class="kv-row"
              data-testid="keyvalue-row"
              @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.field, rowAt(i)!.value)"
            >
              <td class="kv-field" data-testid="keyvalue-field">{{ rowAt(i)?.field }}</td>
              <td class="kv-value" data-testid="keyvalue-value">
                {{ rowAt(i)?.value }}
                <span v-if="rowAt(i)?.isTruncated" class="truncated-marker" title="value truncated"
                  >(truncated)</span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="status-line" data-testid="keyvalue-status">{{ statusLine }}</div>
    </template>
  </div>
</template>

<style scoped>
.keyvalue-view {
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

.kv-table {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--kira-font-family);
  font-size: 11px;
}

.kv-table thead th {
  position: sticky;
  top: 0;
  text-align: left;
  padding: 4px 8px;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  font-weight: 600;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.kv-row {
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.kv-field {
  padding: 4px 8px;
  color: var(--kira-fg-muted);
  white-space: nowrap;
  vertical-align: top;
}

.kv-value {
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
