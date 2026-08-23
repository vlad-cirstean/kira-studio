<script setup lang="ts">
import type { StreamTabRecord } from '@shared/domain/tabs';
import { pathTail } from '@shared/domain/tree';
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import { cellClass } from '../../theme/cellClass';
import { connColorVar } from '../../theme/connColor';
import Button from '../../theme/primitives/Button.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import ReconnectGate from '../../theme/primitives/ReconnectGate.vue';
import Strip from '../../theme/primitives/Strip.vue';
import ViewChrome from '../../workbench/panels/ViewChrome.vue';
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

// P16 design system LAW: connection colour is a 2px rail — here capping the toolbar and as a
// dot in the view header — never a background tint. Mirrors Toolbar.vue's `color`/`railStyle`
// pair exactly. No colour assigned leaves `--kira-rail` unset, so the reserved slot stays blank
// instead of shifting anything.
const connectionRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);
const iconColor = computed(
  () => connColorVar(connectionRecord.value?.color) ?? 'var(--kira-fg-muted)',
);

const pathPrefix = computed(() =>
  connectionRecord.value ? `${connectionRecord.value.name} / ` : '',
);

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
    <ReconnectGate
      v-if="needsReconnect"
      icon="debug-disconnect"
      label="Not connected"
      container-testid="stream-reconnect"
      button-testid="stream-reconnect-load"
      @reconnect="onReconnectAndLoad"
    />
    <ViewChrome
      v-else
      :tab="tab"
      icon="broadcast"
      :icon-color="iconColor"
      :path="pathPrefix"
      :name="targetTail?.name ?? tab.path"
      name-testid="stream-target"
      refresh-testid="stream-refresh"
      stop-testid="stream-stop"
      :can-stop="running"
      @refresh="reload(tab.id)"
      @stop="onStop"
    >
      <template #head-trailing>
        <span
          v-if="page?.visibilityTimeoutSeconds !== null && page?.visibilityTimeoutSeconds !== undefined"
          class="p-badge"
          data-testid="stream-visibility-timeout"
        >
          visibility {{ page.visibilityTimeoutSeconds }}s
        </span>
      </template>

      <template #toolbar>
        <IconButton
          icon="symbol-number"
          :size="13"
          data-testid="stream-count"
          title="Count"
          @click="runCount(tab.id)"
        />
        <Button
          v-if="isBatch"
          icon="arrow-swap"
          active
          data-testid="stream-poll"
          title="Poll for messages"
          @click="onPoll"
        >
          Poll
        </Button>
        <IconButton
          v-else
          icon="arrow-right"
          :size="13"
          data-testid="stream-next"
          :disabled="!rt?.hasMore"
          title="Next page"
          @click="goNext(tab.id)"
        />
      </template>

      <!-- The one destructive truth of this view, stated once at the top. -->
      <template #strips>
      <Strip v-if="isBatch" tone="warn" icon="warning" :icon-size="13" data-testid="stream-poll-warning">
        <span
          >Each poll <b>consumes</b> messages from the queue (subject to the visibility timeout
          above) — it does not browse a stable position.</span
        >
      </Strip>

      <Strip v-if="rt?.status === 'error' && rt.error" tone="err" icon="error" :icon-size="13" data-testid="stream-error">
        <span>{{ rt.error.message }}</span>
      </Strip>
      </template>

      <div class="list-body" data-testid="stream-list">
        <EmptyState
          v-if="isBatch && !rt?.polled"
          class="no-rows"
          icon="arrow-swap"
          label="Click Poll to fetch messages"
        />
        <EmptyState
          v-else-if="!rt || rt.rowCount === 0"
          class="no-rows"
          icon="inbox"
          :label="rt ? 'No messages' : ''"
        />
        <template v-else>
          <div class="p-thead">
            <div class="p-th gutter" style="width: 40px" />
            <div class="p-th" style="width: 160px"><span class="name">key</span></div>
            <div class="p-th" style="width: 160px"><span class="name">timestamp</span></div>
            <div class="p-th" style="width: 140px"><span class="name">headers</span></div>
            <div class="p-th" style="width: 140px"><span class="name">attrs</span></div>
            <div class="p-th" style="flex: 1"><span class="name">body</span></div>
          </div>
          <div class="tbody-scroll">
            <div
              v-for="i in rowIndices"
              :key="i"
              class="stream-row"
              data-testid="stream-row"
              @contextmenu="onRowContextMenu($event, rowAt(i)?.key ?? null, rowAt(i)?.body ?? '')"
            >
              <div class="p-td gutter" style="width: 40px">{{ i + 1 }}</div>
              <div
                class="p-td"
                :class="cellClass({ isNull: rowAt(i)?.key === null })"
                style="width: 160px"
                data-testid="stream-key"
              >
                {{ rowAt(i)?.key ?? '(none)' }}
              </div>
              <div class="p-td" style="width: 160px" data-testid="stream-timestamp">
                {{ rowAt(i)?.timestamp ?? '' }}
              </div>
              <div class="p-td" style="width: 140px" data-testid="stream-headers">
                {{ rowAt(i)?.headers }}
              </div>
              <div class="p-td" style="width: 140px" data-testid="stream-attrs">
                {{ rowAt(i)?.attrs }}
              </div>
              <div class="p-td msg-body" style="flex: 1" data-testid="stream-body">
                {{ rowAt(i)?.body }}
                <span v-if="rowAt(i)?.isTruncated" class="p-xs muted" title="body truncated"
                  >(truncated)</span
                >
              </div>
            </div>
          </div>
        </template>
      </div>

      <div class="status-line" data-testid="stream-status">{{ statusLine }}</div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.stream-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* view header: 28px, connection colour appears only as the dot (LAW — see template comment) */
.path {
  color: var(--kira-fg-disabled);
}

/* tabular body shared shape (P16's .thead/.th/.td law) — .p-thead/.p-th/.p-td come from
   primitives.css; the flex row container and the scrolling wrapper around it are local glue,
   same as the source design's own (unshared) .tbody/.tr rules. */
.tbody-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.stream-row {
  display: flex;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.stream-row:hover {
  background: var(--kira-hover);
}

/* body column: monospace and slightly muted, matching the mockup's `.msg-body` */
.msg-body {
  font-family: var(--kira-font-family);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.list-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-body .p-empty {
  height: 100%;
}

.status-line {
  flex-shrink: 0;
  padding: 0 var(--kira-s-4);
  height: var(--kira-h-xs);
  display: flex;
  align-items: center;
  border-top: var(--kira-border-width) solid var(--kira-border);
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
