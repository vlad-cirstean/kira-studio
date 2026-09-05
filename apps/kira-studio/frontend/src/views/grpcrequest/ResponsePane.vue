<script setup lang="ts">
import { GRPC_CODE_NAMES, type GrpcResponsePane, grpcCodeClass } from '@shared/domain/grpc';
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, ref, watch } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { formatBytes } from '../../format';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import VirtualList from '../../theme/primitives/VirtualList.vue';
import CallHistoryList from './CallHistoryList.vue';
import { backToLatestGrpc, ensureGrpcHistoryLoaded, grpcHistoryRuntime } from './history';
import { runtime } from './state';

// D14: three segments — Messages · Metadata · History — and deliberately no Raw, no Timeline (D14
// answers P9 OQ-9/P10 OQ-8: absent, not a degraded pane — the message list and this status line
// already are the honest view for this protocol, F7).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const historyRt = computed(() => grpcHistoryRuntime[props.tab.id]);

onMounted(() => {
  ensureGrpcHistoryLoaded(props.tab.id);
});

watch(
  () => props.tab.state.itemId,
  () => {
    const hrt = historyRt.value;
    if (hrt) hrt.entries = null;
    ensureGrpcHistoryLoaded(props.tab.id);
  },
);

// D10: the source swap — a selected history entry's snapshot, or the live call, or none.
const viewing = computed(() => historyRt.value?.viewing ?? null);
const liveResult = computed(() => rt.value?.result ?? null);
const liveMessages = computed(() => rt.value?.messages ?? []);

const hasHistory = computed(() => (historyRt.value?.entries?.length ?? 0) > 0);
const historyCount = computed(() => historyRt.value?.entries?.length ?? 0);

const codeName = computed(() => {
  if (viewing.value) return viewing.value.snapshot.entry.codeName;
  if (liveResult.value)
    return liveResult.value.codeName || GRPC_CODE_NAMES[liveResult.value.code] || 'UNKNOWN';
  return '';
});
const code = computed(() =>
  viewing.value ? viewing.value.snapshot.entry.code : (liveResult.value?.code ?? 0),
);
const statusMessage = computed(() =>
  viewing.value
    ? viewing.value.snapshot.entry.statusMessage
    : (liveResult.value?.statusMessage ?? ''),
);
const elapsedMs = computed(() =>
  viewing.value ? viewing.value.snapshot.entry.elapsedMs : (liveResult.value?.elapsedMs ?? 0),
);
// Finding 11: rt.messageBytes is a running total kept incrementally by state.ts's own push
// handler — reading it here is O(1); the old `rt.value.messages.reduce(...)` re-summed the whole
// (potentially 10,000-message) array on every single push.
const messageBytes = computed(() =>
  viewing.value ? viewing.value.snapshot.entry.messageBytes : (rt.value?.messageBytes ?? 0),
);
const messages = computed(() =>
  viewing.value
    ? viewing.value.snapshot.messages.map((m) => ({
        seq: m.seq,
        json: m.json,
        wireBytes: m.wireBytes,
        offsetMs: m.offsetMs,
      }))
    : liveMessages.value,
);
// Round-2 review finding 10: the summary line used to read messages.length — capped at
// MAX_LIVE_MESSAGES for a live call (state.ts) and at maxGrpcStoredMessages for a stored entry
// (finding 8) — right next to a separate elided-messages strip stating the true, uncapped total,
// two contradictory counts on screen at once for the same response. Sourced from the true total
// instead: rt.trueMessageCount for live, the stored entry's own true messageCount for history.
const messageCount = computed(() =>
  viewing.value ? viewing.value.snapshot.entry.messageCount : (rt.value?.trueMessageCount ?? 0),
);
// D15/D17: the live view keeps only the most recent MAX_LIVE_MESSAGES (state.ts) — this is true
// only for a live, still/just-streamed call, never a stored history entry's own capped snapshot
// (finding 8's own "first N of M" note above covers that case with its own wording).
const liveMessagesElided = computed(
  () => !viewing.value && (rt.value?.trueMessageCount ?? 0) > messages.value.length,
);
const header = computed(() =>
  viewing.value ? viewing.value.snapshot.header : (liveResult.value?.header ?? []),
);
const trailer = computed(() =>
  viewing.value ? viewing.value.snapshot.trailer : (liveResult.value?.trailer ?? []),
);

const hasResult = computed(
  () => !!viewing.value || !!liveResult.value || (rt.value?.status ?? 'idle') !== 'idle',
);

const RESPONSE_PANE_OPTIONS = [
  { value: 'messages' as const, label: 'Messages', testid: 'grpc-response-pane-messages' },
  { value: 'metadata' as const, label: 'Metadata', testid: 'grpc-response-pane-metadata' },
  { value: 'history' as const, label: 'History', testid: 'grpc-response-pane-history' },
];

function setResponsePane(pane: GrpcResponsePane): void {
  patchGrpcRequestTabState(props.tab.id, { responsePane: pane });
}

function viewHistory(): void {
  setResponsePane('history');
}

const expanded = ref<Set<number>>(new Set());
function toggleExpanded(seq: number): void {
  const next = new Set(expanded.value);
  if (next.has(seq)) next.delete(seq);
  else next.add(seq);
  expanded.value = next;
}

// Finding 11: the message list is now a VirtualList (below), which needs one known height per
// row — MESSAGE_ROW_HEIGHT for a collapsed header, or that plus MESSAGE_DETAIL_HEIGHT for an
// expanded one (a fixed, internally-scrollable box, not an auto-growing one — the same "one
// resolved height per row" contract OperationsPanel.vue's own expandable row already follows). A
// per-row rowHeights array is passed only while something is actually expanded (the rare,
// deliberate case): the common case — a stream appending thousands of collapsed messages — stays
// on VirtualList's O(1) uniform-height path instead of remapping every row on every single push.
const MESSAGE_ROW_HEIGHT = 22; // matches --kira-h-sm
const MESSAGE_DETAIL_HEIGHT = 200;
const messageRowHeights = computed<readonly number[] | undefined>(() => {
  if (expanded.value.size === 0) return undefined;
  return messages.value.map((m) =>
    expanded.value.has(m.seq) ? MESSAGE_ROW_HEIGHT + MESSAGE_DETAIL_HEIGHT : MESSAGE_ROW_HEIGHT,
  );
});
// D14: a unary call is the same pane with exactly one entry, expanded.
watch(
  messages,
  (msgs) => {
    if (msgs.length === 1) expanded.value = new Set([msgs[0].seq]);
  },
  { immediate: true },
);

function onBackToLatest(): void {
  backToLatestGrpc(props.tab.id);
}

const viewingTime = computed(() => {
  const iso = viewing.value?.snapshot.entry.calledAt;
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour12: false });
});
</script>

<template>
  <div class="response-pane" data-testid="grpc-response-pane">
    <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="grpc-call-error">
      {{ rt.error.message }}
    </MessageStrip>

    <template v-if="hasResult || hasHistory">
      <div class="response-status-row p-toolbar">
        <template v-if="code !== undefined && (liveResult || viewing)">
          <span class="p-chip" :class="grpcCodeClass(code)" data-testid="grpc-status-chip">
            {{ codeName }} ({{ code }})
          </span>
          <span v-if="statusMessage" class="p-xs muted status-hint" data-testid="grpc-status-message">{{
            statusMessage
          }}</span>
          <span class="p-push" />
          <span class="p-xs dim" data-testid="grpc-elapsed">{{ elapsedMs }} ms</span>
          <span class="p-xs dim" data-testid="grpc-message-summary">
            {{ messageCount }} message{{ messageCount === 1 ? '' : 's' }} · {{ formatBytes(messageBytes) }}
          </span>
        </template>
        <span v-else class="p-push" />
        <SegmentedControl
          :model-value="tab.state.responsePane"
          :options="RESPONSE_PANE_OPTIONS"
          data-testid="grpc-response-pane-toggle"
          @update:model-value="setResponsePane"
        />
      </div>

      <MessageStrip v-if="viewing" tone="note" data-testid="grpc-history-band">
        Viewing the call from {{ viewingTime }} · {{ viewing?.snapshot.method }}
        <AppButton class="strip-action" data-testid="grpc-history-back" @click="onBackToLatest">
          {{ rt?.result ? 'Back to latest' : 'Close' }}
        </AppButton>
      </MessageStrip>

      <!-- D11: a streaming call's history entry stores only the first maxGrpcStoredMessages
           (finding 8) — this is the one place that ever becomes visible now that ServerStream
           actually fills Messages/MessageCount in. -->
      <MessageStrip
        v-if="viewing?.snapshot.messagesElided"
        tone="note"
        data-testid="grpc-history-messages-elided"
      >
        Showing the first {{ messages.length }} of {{ viewing.snapshot.entry.messageCount }} messages.
      </MessageStrip>

      <MessageStrip
        v-if="rt?.status === 'cancelled'"
        tone="warn"
        data-testid="grpc-stopped-strip"
      >
        Stopped after {{ messages.length }} message{{ messages.length === 1 ? '' : 's' }}.
      </MessageStrip>

      <!-- D15/D17: the live view's own ceiling (state.ts's MAX_LIVE_MESSAGES) — finding 11. -->
      <MessageStrip
        v-if="liveMessagesElided"
        tone="note"
        data-testid="grpc-live-messages-elided"
      >
        Showing the most recent {{ messages.length }} of {{ rt?.trueMessageCount }} messages.
      </MessageStrip>

      <CallHistoryList v-if="tab.state.responsePane === 'history'" :tab="tab" />
      <div v-else-if="tab.state.responsePane === 'metadata'" class="metadata-groups" data-testid="grpc-response-metadata">
        <div class="metadata-group">
          <div class="metadata-group-title p-xs muted">Header</div>
          <div v-for="(h, i) in header" :key="`h${i}`" class="p-kv-row">
            <span class="p-kv-name mono">{{ h.name }}</span>
            <span class="p-kv-value mono">{{ h.value }}</span>
          </div>
          <div v-if="header.length === 0" class="p-xs dim">No header metadata</div>
        </div>
        <div class="metadata-group">
          <div class="metadata-group-title p-xs muted">Trailer</div>
          <div v-for="(t, i) in trailer" :key="`t${i}`" class="p-kv-row">
            <span class="p-kv-name mono">{{ t.name }}</span>
            <span class="p-kv-value mono">{{ t.value }}</span>
          </div>
          <div v-if="trailer.length === 0" class="p-xs dim">No trailer metadata</div>
        </div>
      </div>
      <div v-else class="message-list" data-testid="grpc-message-list">
        <VirtualList
          v-if="messages.length > 0"
          class="message-virtual-list"
          :items="messages"
          :row-height="MESSAGE_ROW_HEIGHT"
          :row-heights="messageRowHeights"
        >
          <template #default="{ item: m }">
            <div class="message-entry" data-testid="grpc-message-entry">
              <button type="button" class="message-header" @click="toggleExpanded(m.seq)">
                <span class="p-xs dim" data-testid="grpc-message-offset">+{{ m.offsetMs }} ms</span>
                <span class="p-xs dim">{{ formatBytes(m.wireBytes) }}</span>
                <span class="p-push" />
                <span class="p-xs dim">#{{ m.seq }}</span>
              </button>
              <div v-if="expanded.has(m.seq)" class="message-detail">
                <CodeMirrorHost :doc="m.json" language="json" :read-only="true" />
              </div>
            </div>
          </template>
        </VirtualList>
        <EmptyState v-if="messages.length === 0" icon="arrow-right" label="Call this method to see its response">
          <button
            v-if="hasHistory"
            type="button"
            class="history-hint-link"
            data-testid="grpc-history-hint"
            @click="viewHistory"
          >
            {{ historyCount }} past call{{ historyCount === 1 ? '' : 's' }} · View history
          </button>
        </EmptyState>
      </div>
    </template>

    <EmptyState v-else icon="arrow-right" label="Call this method to see its response" />
  </div>
</template>

<style scoped>
.response-pane {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.response-status-row {
  gap: var(--kira-s-2);
}

.status-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.message-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.message-virtual-list {
  flex: 1;
  min-height: 0;
}

.message-entry {
  display: flex;
  flex-direction: column;
}

/* height (not padding) so this row's own rendered height stays exactly MESSAGE_ROW_HEIGHT
   (22px, the script's own numeric constant, kept equal to --kira-h-sm here) — VirtualList
   positions every row assuming that exact height, border included via box-sizing. */
.message-header {
  width: 100%;
  height: var(--kira-h-sm);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-3);
  background: none;
  border: none;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
  font: inherit;
  color: var(--kira-fg);
}

.message-header:hover {
  background: var(--kira-hover);
}

/* Fixed height (not auto-grow) for the same reason .message-header's is — MUST stay numerically
   equal to the script's own MESSAGE_DETAIL_HEIGHT (200px); a JSON document taller than this
   scrolls inside CodeMirrorHost's own scroller instead of growing the row. */
.message-detail {
  height: 200px;
  box-sizing: border-box;
  overflow: auto;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.metadata-groups {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-4);
}

.metadata-group-title {
  margin-bottom: var(--kira-s-1);
}


.history-hint-link {
  margin-top: var(--kira-s-2);
  background: none;
  border: none;
  padding: 0;
  color: var(--kira-accent);
  cursor: pointer;
  font-size: var(--kira-t-sm);
}
</style>
