<script setup lang="ts">
import type { KeyValueTabRecord } from '@shared/domain/tabs';
import { decodePath, pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import Button from '../../theme/primitives/Button.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
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

const connRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);

// P16 design system LAW: connection colour reaches the view as a 2px rail (the toolbar cap)
// plus a dot (the view header) — never a tint or a full border. Mirrors Toolbar.vue/TreeRow.vue.
const connColor = computed(() => connRecord.value?.color);
const iconColor = computed(() =>
  connColor.value ? `var(--kira-conn-${connColor.value})` : 'var(--kira-info)',
);

// The view header's breadcrumb: "connection / dbN / ". Redis's tree always roots a key's path
// at its `database` segment (see redis/catalog.ts), so this reads existing path structure —
// no new state.
const dbLabel = computed(() => {
  if (!props.tab.connectionId) return null;
  try {
    return (
      decodePath(props.tab.connectionId, props.tab.path).segments.find((s) => s.kind === 'database')
        ?.name ?? null
    );
  } catch {
    return null;
  }
});

const pathPrefix = computed(() =>
  dbLabel.value
    ? `${connRecord.value?.name ? `${connRecord.value.name} / ` : ''}${dbLabel.value} / `
    : '',
);

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
    <div v-if="needsReconnect" class="p-empty" data-testid="keyvalue-reconnect">
      <Button
        variant="primary"
        kind="dialog"
        data-testid="keyvalue-reconnect-load"
        @click="onReconnectAndLoad"
      >
        Reconnect &amp; load
      </Button>
    </div>
    <ViewChrome
      v-else
      :tab="tab"
      icon="key"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      target-testid="keyvalue-target"
      refresh-testid="keyvalue-refresh"
      stop-testid="keyvalue-stop"
      :can-stop="running"
      @refresh="reload(tab.id)"
      @stop="onStop"
    >
      <template #badges>
        <template v-if="page">
          <span class="p-badge" data-testid="keyvalue-type">{{ page.redisType }}</span>
          <!-- TTL is styled as a warning chip, not a neutral badge: a key that is about to
               vanish should look like one (see the mockup's KeyValue.html). -->
          <span class="p-chip" :class="{ warn: page.ttlMs !== null }" data-testid="keyvalue-ttl">
            <Codicon name="history" :size="11" />
            {{ page.ttlMs !== null ? `expires in ${ttlText(page.ttlMs)}` : 'no expiry' }}
          </span>
          <span class="p-badge" data-testid="keyvalue-memory">{{ memoryText(page.memoryBytes) }}</span>
          <span v-if="connRecord" class="p-badge">{{ connRecord.readOnly ? 'read-only' : 'read-write' }}</span>
        </template>
      </template>

      <template #toolbar>
        <div class="sep" />
        <div class="group">
          <IconButton
            icon="arrow-left"
            :size="13"
            data-testid="keyvalue-prev"
            :disabled="prevDisabled"
            title="Previous page"
            @click="goPrev(tab.id)"
          />
          <span class="mono p-sm muted" data-testid="keyvalue-status">{{ statusLine }}</span>
          <IconButton
            icon="arrow-right"
            :size="13"
            data-testid="keyvalue-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          />
          <Button
            icon="symbol-number"
            data-testid="keyvalue-count"
            title="Exact count"
            @click="runCount(tab.id)"
          >Exact count</Button>
        </div>
      </template>

      <template #strips>
        <div v-if="rt?.status === 'error' && rt.error" class="p-strip err" data-testid="keyvalue-error">
          {{ rt.error.message }}
        </div>
      </template>

      <div class="p-panel table-panel">
        <div class="p-thead">
          <div class="p-th gutter kv-col-gutter"></div>
          <div class="p-th kv-col-field">
            <span class="name">{{
              page?.redisType === 'string' ? '' : page?.redisType === 'list' ? 'index' : 'field'
            }}</span>
          </div>
          <div class="p-th kv-col-value">
            <span class="name">{{ page?.redisType === 'zset' ? 'score' : 'value' }}</span>
          </div>
        </div>
        <div class="tbody" data-testid="keyvalue-list">
          <div v-if="!rt || rt.rowCount === 0" class="p-empty">
            <span class="label">{{ rt ? 'No data' : '' }}</span>
          </div>
          <template v-else>
            <div
              v-for="i in rowIndices"
              :key="i"
              class="kv-row"
              data-testid="keyvalue-row"
              @contextmenu="rowAt(i) && onRowContextMenu($event, rowAt(i)!.field, rowAt(i)!.value)"
            >
              <div class="p-td gutter kv-col-gutter">{{ i + 1 }}</div>
              <div class="p-td kv-col-field" :title="rowAt(i)?.field" data-testid="keyvalue-field">
                {{ rowAt(i)?.field }}
              </div>
              <div class="p-td kv-col-value" :title="rowAt(i)?.value" data-testid="keyvalue-value">
                {{ rowAt(i)?.value }}
                <span v-if="rowAt(i)?.isTruncated" class="p-chip truncated-chip" title="value truncated"
                  >truncated</span
                >
              </div>
            </div>
          </template>
        </div>
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.keyvalue-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.table-panel {
  flex: 1;
  min-height: 0;
  border: none;
  border-radius: 0;
}

.tbody {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
}

.kv-col-gutter {
  width: 40px;
  flex-shrink: 0;
}

.kv-col-field {
  width: 220px;
  flex-shrink: 0;
}

.kv-col-value {
  flex: 1;
  min-width: 0;
}

.kv-row {
  height: var(--kira-row-height);
  display: flex;
}

.kv-row:hover {
  background: var(--kira-hover);
}

.truncated-chip {
  margin-left: var(--kira-s-3);
  flex-shrink: 0;
  background: var(--kira-bg-input);
  color: var(--kira-fg-disabled);
}
</style>
