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

// P16 design system LAW: connection colour is a 2px rail — here capping the toolbar and as a
// dot in the view header — never a background tint. Mirrors Toolbar.vue's `color`/`railStyle`
// pair exactly. No colour assigned leaves `--kira-rail` unset, so the reserved slot stays blank
// instead of shifting anything.
const connectionRecord = computed(() =>
  props.tab.connectionId
    ? connectionsState.records.find((r) => r.id === props.tab.connectionId)
    : undefined,
);
const railStyle = computed(() => ({
  '--kira-rail': connectionRecord.value?.color
    ? `var(--kira-conn-${connectionRecord.value.color})`
    : undefined,
}));

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
    <div v-if="needsReconnect" class="p-empty" data-testid="stream-reconnect">
      <Codicon name="debug-disconnect" :size="24" class="big" />
      <span class="label">Not connected</span>
      <button
        type="button"
        class="p-dlgbtn primary"
        data-testid="stream-reconnect-load"
        @click="onReconnectAndLoad"
      >
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <!-- LAW: the view header is 28px, and the connection colour appears here only as a dot
           (never a tint) — the rail below caps the toolbar instead, per Toolbar.vue. -->
      <div class="p-view-head">
        <span class="p-conn-dot" :class="{ none: !connectionRecord?.color }" :style="railStyle" title="Connection colour" />
        <span class="icon-box" :style="{ color: connectionRecord?.color ? `var(--kira-conn-${connectionRecord?.color})` : 'var(--kira-fg-muted)' }">
          <Codicon name="broadcast" :size="14" />
        </span>
        <span class="p-view-target">
          <span v-if="connectionRecord" class="path">{{ connectionRecord.name }} / </span>
          <span data-testid="stream-target">{{ targetTail?.name ?? tab.path }}</span>
        </span>
        <span
          v-if="page?.visibilityTimeoutSeconds !== null && page?.visibilityTimeoutSeconds !== undefined"
          class="p-badge p-push"
          data-testid="stream-visibility-timeout"
        >
          visibility {{ page.visibilityTimeoutSeconds }}s
        </span>
      </div>

      <!-- LAW: the connection colour caps the toolbar as a 2px rail, never the whole panel. -->
      <div class="p-toolbar-rail" :style="railStyle" />
      <div class="p-toolbar">
        <div class="group">
          <button
            type="button"
            class="p-iconbtn"
            data-testid="stream-refresh"
            title="Refresh"
            @click="reload(tab.id)"
          >
            <Codicon name="refresh" :size="13" />
          </button>
          <button
            type="button"
            class="p-iconbtn"
            data-testid="stream-count"
            title="Count"
            @click="runCount(tab.id)"
          >
            <Codicon name="symbol-number" :size="13" />
          </button>
          <button
            v-if="isBatch"
            type="button"
            class="p-btn is-active"
            data-testid="stream-poll"
            title="Poll for messages"
            @click="onPoll"
          >
            <span class="icon-box"><Codicon name="arrow-swap" :size="13" /></span>
            Poll
          </button>
          <button
            v-else
            type="button"
            class="p-iconbtn"
            data-testid="stream-next"
            :disabled="!rt?.hasMore"
            title="Next page"
            @click="goNext(tab.id)"
          >
            <Codicon name="arrow-right" :size="13" />
          </button>
          <!-- LAW: Stop always follows the verb that started the work, disabled when idle — never
               its own separate control elsewhere. -->
          <button
            v-if="running"
            type="button"
            class="p-iconbtn"
            data-testid="stream-stop"
            title="Stop"
            style="color: var(--kira-error)"
            @click="onStop"
          >
            <Codicon name="debug-stop" :size="13" />
          </button>
          <!-- LAW: work-in-progress is a ring in the toolbar next to the verb that started it,
               never a bar across the top of the view. -->
          <span
            class="p-run-state"
            :class="{ 'is-running': running, 'is-error': rt?.status === 'error' }"
            :title="running ? 'Loading' : rt?.status === 'error' ? 'Last run failed' : undefined"
          >
            <span class="ring" />
          </span>
        </div>
      </div>

      <!-- The one destructive truth of this view, stated once at the top. -->
      <div v-if="isBatch" class="p-strip warn" data-testid="stream-poll-warning">
        <span class="icon-box"><Codicon name="warning" :size="13" /></span>
        <span
          >Each poll <b>consumes</b> messages from the queue (subject to the visibility timeout
          above) — it does not browse a stable position.</span
        >
      </div>

      <div v-if="rt?.status === 'error' && rt.error" class="p-strip err" data-testid="stream-error">
        <span class="icon-box"><Codicon name="error" :size="13" /></span>
        <span>{{ rt.error.message }}</span>
      </div>

      <div class="list-body" data-testid="stream-list">
        <div v-if="isBatch && !rt?.polled" class="p-empty no-rows">
          <Codicon name="arrow-swap" :size="24" class="big" />
          <span class="label">Click Poll to fetch messages</span>
        </div>
        <div v-else-if="!rt || rt.rowCount === 0" class="p-empty no-rows">
          <Codicon name="inbox" :size="24" class="big" />
          <span class="label">{{ rt ? 'No messages' : '' }}</span>
        </div>
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
                :class="{ null: rowAt(i)?.key === null }"
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
