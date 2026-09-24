<script setup lang="ts">
import {
  GRPC_CODE_NAMES,
  type GrpcResponsePane,
  grpcCodeClass,
  grpcCodeHint,
} from '@shared/domain/grpc';
import { useVirtualizer } from '@tanstack/vue-virtual';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { registerCommand } from '@workbench/shortcuts/commands';
import { formatBytes } from '@workbench/util/format';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
import { DEFAULT_FIND_OPTIONS, type FindOptions, findRanges } from '../../editor/findRanges';
import MonacoHost from '../../editor/MonacoHost.vue';
import type { RangeHighlight } from '../../editor/ranges';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import ResponseFindBar, {
  type FindBarHost,
  type FindBarTarget,
} from '../shared/ResponseFindBar.vue';
import CallHistoryList from './CallHistoryList.vue';
import { useGrpcCallHistoryStore } from './history';
import { useGrpcRequestViewStore } from './state';

// D14: three segments — Messages · Metadata · History — and deliberately no Raw, no Timeline (D14
// answers P9 OQ-9/P10 OQ-8: absent, not a degraded pane — the message list and this status line
// already are the honest view for this protocol, F7).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();
const grpcRequestViewStore = useGrpcRequestViewStore();
const grpcCallHistoryStore = useGrpcCallHistoryStore();

const rt = computed(() => grpcRequestViewStore.runtime[props.tab.id]);
const historyRt = computed(() => grpcCallHistoryStore.runtime[props.tab.id]);

onMounted(() => {
  grpcCallHistoryStore.ensureGrpcHistoryFresh(props.tab.id);
});

watch(
  () => props.tab.state.itemId,
  () => {
    const hrt = historyRt.value;
    if (hrt) hrt.entries = null;
    grpcCallHistoryStore.ensureGrpcHistoryFresh(props.tab.id);
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

// P18 D14: the chip/hint/elapsed/summary group only makes sense once there is a code to show —
// same gate the template already used for that group, named here so the hint computed can share
// it without duplicating the condition.
const hasCode = computed(() => !!liveResult.value || !!viewing.value);
// P28 D1 reverses P18 D13's always-visible line, matching the identical change on the HTTP
// response pane: the meaning is now the status chip's tooltip. The server's own statusMessage
// keeps its own line — that is a message from the server, not a restatement of the code.
const codeHint = computed(() => (hasCode.value ? grpcCodeHint(code.value) : ''));

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

// Finding 11: the message list is virtualized (below), which needs one known height per row —
// MESSAGE_ROW_HEIGHT for a collapsed header, or that plus MESSAGE_DETAIL_HEIGHT for an expanded
// one (a fixed, internally-scrollable box, not an auto-growing one — the same "one resolved
// height per row" contract OperationsPanel.vue's own expandable row already follows).
const MESSAGE_ROW_HEIGHT = 22; // matches --kira-h-sm
const MESSAGE_DETAIL_HEIGHT = 200;
function messageRowHeight(index: number): number {
  const m = messages.value[index];
  return m && expanded.value.has(m.seq) ? MESSAGE_ROW_HEIGHT + MESSAGE_DETAIL_HEIGHT : MESSAGE_ROW_HEIGHT;
}

// P104 §3.4: @tanstack/vue-virtual replaces VirtualList.vue directly at this call site.
// estimateSize is the *actual* per-row height, not merely a first guess (P27 D18's own "rowHeights
// replaces the uniform math" contract, carried over unchanged) — options are a computed, so
// toggling one row's expanded state re-measures through the same reactive path count does.
const scrollRef = ref<HTMLElement | null>(null);
const messageVirtualizer = useVirtualizer(
  computed(() => ({
    count: messages.value.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: messageRowHeight,
    overscan: 8,
    getItemKey: (index: number) => messages.value[index]?.seq ?? index,
  })),
);
const virtualMessages = computed(() => messageVirtualizer.value.getVirtualItems());
const totalMessagesSize = computed(() => messageVirtualizer.value.getTotalSize());
const visibleMessages = computed(() =>
  virtualMessages.value.map((row) => ({ row, m: messages.value[row.index] })),
);
// D14: a unary call is the same pane with exactly one entry, expanded.
watch(
  messages,
  (msgs) => {
    if (msgs.length === 1) expanded.value = new Set([msgs[0].seq]);
  },
  { immediate: true },
);

function onBackToLatest(): void {
  grpcCallHistoryStore.backToLatestGrpc(props.tab.id);
}

// P22b D14: find-in-message — HTTP's own ResponsePane.vue find bar (P16 D11), applied to the one
// surface the row calls out as the real gap: the message list has no search at all. The message
// list is a VirtualList (only visible rows are ever mounted), so unlike HTTP's single always-
// mounted body this can only search whichever message is actually expanded and on screen right
// now — the lowest-seq expanded one, deterministic when more than one is open. A unary call's own
// auto-expand (above) makes this the common case land exactly right with no extra action.
const findOpen = ref(false);
function toggleFind(): void {
  findOpen.value = !findOpen.value;
}
function closeFind(): void {
  findOpen.value = false;
}

const targetSeq = computed<number | null>(() => {
  if (expanded.value.size === 0) return null;
  return Math.min(...expanded.value);
});
const targetMessage = computed(() => messages.value.find((m) => m.seq === targetSeq.value) ?? null);

// Function refs, not a single ref — VirtualList only mounts the rows currently on screen, so the
// host for `targetSeq` may not exist at all (scrolled out) even while its seq is in `expanded`.
// `scrollRangeIntoView` on a null host is simply a no-op via optional chaining below, same as
// HTTP's own bodyHostRef before its first render.
const messageHosts = new Map<number, FindBarHost>();
function setMessageHost(seq: number, el: unknown): void {
  if (el && typeof el === 'object' && 'scrollRangeIntoView' in el) {
    messageHosts.set(seq, el as FindBarHost);
  } else {
    messageHosts.delete(seq);
  }
}

// P28 D11: the options object joins the exposed pair — see the HTTP pane's own note.
const findBarRef = ref<{
  query: string;
  currentGlobal: number;
  options: FindOptions;
} | null>(null);
const findTargets = computed<readonly FindBarTarget[]>(() => {
  if (!findOpen.value || !targetMessage.value) return [];
  const seq = targetMessage.value.seq;
  return [{ doc: targetMessage.value.json, host: messageHosts.get(seq) ?? null }];
});
const messageHighlights = computed<(doc: string) => readonly RangeHighlight[]>(() => {
  const bar = findBarRef.value;
  const query = bar?.query ?? '';
  if (!query || findTargets.value.length === 0) return () => [];
  const currentGlobal = bar?.currentGlobal ?? -1;
  const options = bar?.options ?? DEFAULT_FIND_OPTIONS;
  return (doc: string) => findRanges(doc, query, currentGlobal, options);
});

const viewingTime = computed(() => {
  const iso = viewing.value?.snapshot.entry.calledAt;
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour12: false });
});

let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  // D14: mirrors HTTP's own ResponsePane.vue registration — opened from the status row's own
  // search button, and by view.find, mounted only while this tab is the active one.
  unregisterCommands = [registerCommand('view.find', toggleFind)];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <div class="response-pane" data-testid="grpc-response-pane">
    <Alert
      v-if="rt?.status === 'error' && rt.error"
      variant="destructive"
      data-testid="grpc-call-error"
    >
      <AlertDescription>{{ rt.error.message }}</AlertDescription>
    </Alert>

    <!-- P18 D14 (P15 D1's gRPC sibling): the status row, the pane switcher and every strip render
         from tab-open — only the response-dependent *contents* below stay conditional. A freshly-
         opened tab used to show no Messages/Metadata/History switcher at all. -->
    <div class="response-status-row p-toolbar">
      <template v-if="hasCode">
        <Tooltip v-if="codeHint">
          <TooltipTrigger as-child>
            <span class="p-chip" :class="grpcCodeClass(code)" data-testid="grpc-status-chip">
              {{ codeName }} ({{ code }})
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ codeHint }}</TooltipContent>
        </Tooltip>
        <span v-else class="p-chip" :class="grpcCodeClass(code)" data-testid="grpc-status-chip">
          {{ codeName }} ({{ code }})
        </span>
        <span class="p-push" />
        <span class="p-xs dim" data-testid="grpc-elapsed">{{ elapsedMs }} ms</span>
        <span class="p-xs dim" data-testid="grpc-message-summary">
          {{ messageCount }} message{{ messageCount === 1 ? '' : 's' }} · {{ formatBytes(messageBytes) }}
        </span>
      </template>
      <span v-else class="p-push" />
      <!-- P22b D14: HTTP's own ResponsePane.vue idiom — only the Messages pane has a document to
           search (Metadata is a plain key-value list, History is a row list). -->
      <Tooltip v-if="tab.state.responsePane === 'messages'">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': findOpen }"
            aria-label="Find in message"
            data-testid="grpc-find-toggle"
            @click="toggleFind"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Find in message</TooltipContent>
      </Tooltip>
      <ToggleGroup
        type="single"
        :model-value="tab.state.responsePane"
        data-testid="grpc-response-pane-toggle"
        @update:model-value="(v) => v && setResponsePane(v as GrpcResponsePane)"
      >
        <ToggleGroupItem
          v-for="opt in RESPONSE_PANE_OPTIONS"
          :key="opt.value"
          :value="opt.value"
          :data-testid="opt.testid"
        >
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <!-- P18 D13's other half, kept: the server's own statusMessage is a message, not a
         restatement of the code, so it stays on its own line free to wrap. -->
    <div v-if="statusMessage" class="p-xs dim status-message" data-testid="grpc-status-message">{{ statusMessage }}</div>

    <Alert v-if="viewing" variant="note" data-testid="grpc-history-band">
      <AlertDescription class="flex items-center gap-3">
        Viewing the call from {{ viewingTime }} · {{ viewing?.snapshot.method }}
        <Button
          variant="toolbar"
          size="kira"
          class="strip-action"
          data-testid="grpc-history-back"
          @click="onBackToLatest"
        >
          {{ rt?.result ? 'Back to latest' : 'Close' }}
        </Button>
      </AlertDescription>
    </Alert>

    <!-- D11: a streaming call's history entry stores only the first maxGrpcStoredMessages
         (finding 8) — this is the one place that ever becomes visible now that ServerStream
         actually fills Messages/MessageCount in. -->
    <Alert
      v-if="viewing?.snapshot.messagesElided"
      variant="note"
      data-testid="grpc-history-messages-elided"
    >
      <AlertDescription>
        Showing the first {{ messages.length }} of {{ viewing.snapshot.entry.messageCount }} messages.
      </AlertDescription>
    </Alert>

    <Alert v-if="rt?.status === 'cancelled'" variant="warn" data-testid="grpc-stopped-strip">
      <AlertDescription>
        Stopped after {{ messages.length }} message{{ messages.length === 1 ? '' : 's' }}.
      </AlertDescription>
    </Alert>

    <!-- D15/D17: the live view's own ceiling (state.ts's MAX_LIVE_MESSAGES) — finding 11. -->
    <Alert v-if="liveMessagesElided" variant="note" data-testid="grpc-live-messages-elided">
      <AlertDescription>
        Showing the most recent {{ messages.length }} of {{ rt?.trueMessageCount }} messages.
      </AlertDescription>
    </Alert>

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
      <div
        v-if="messages.length > 0"
        ref="scrollRef"
        class="message-virtual-list"
        data-testid="virtual-list"
      >
        <div class="message-virtual-inner" :style="{ height: `${totalMessagesSize}px` }">
          <div
            v-for="entry in visibleMessages"
            :key="entry.row.index"
            class="message-entry"
            data-testid="grpc-message-entry"
            :style="{ transform: `translateY(${entry.row.start}px)` }"
          >
            <button type="button" class="message-header" @click="toggleExpanded(entry.m.seq)">
              <span class="p-xs dim" data-testid="grpc-message-offset">+{{ entry.m.offsetMs }} ms</span>
              <span class="p-xs dim">{{ formatBytes(entry.m.wireBytes) }}</span>
              <span class="p-push" />
              <span class="p-xs dim">#{{ entry.m.seq }}</span>
            </button>
            <div v-if="expanded.has(entry.m.seq)" class="message-detail">
              <MonacoHost
                :ref="(el) => setMessageHost(entry.m.seq, el)"
                :doc="entry.m.json"
                language="json"
                :read-only="true"
                :range-highlights="entry.m.seq === targetSeq ? messageHighlights : undefined"
              />
            </div>
          </div>
        </div>
      </div>
      <Alert v-if="messages.length === 0" class="empty-state" variant="default">
        <CodiconIcon name="arrow-right" :size="24" class="empty-state-icon" />
        <AlertTitle class="empty-state-title">Call this method to see its response</AlertTitle>
        <button
          v-if="hasHistory"
          type="button"
          class="history-hint-link"
          data-testid="grpc-history-hint"
          @click="viewHistory"
        >
          {{ historyCount }} past call{{ historyCount === 1 ? '' : 's' }} · View history
        </button>
      </Alert>
    </div>

    <!-- D14: docked below the pane it searches (LAW 03), mirroring HTTP's own ResponsePane.vue. -->
    <ResponseFindBar
      v-if="findOpen && tab.state.responsePane === 'messages'"
      ref="findBarRef"
      :targets="findTargets"
      @close="closeFind"
    />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.response-pane {
  @apply flex h-full min-h-0 flex-col;
}

.response-status-row {
  @apply gap-1;
}

.status-message {
  @apply px-1.5 pt-0 pb-1;
}

.message-list {
  @apply flex flex-1 min-h-0 flex-col;
}

/* P104 §3.4: the scroll element @tanstack/vue-virtual measures and virtualizes against — this
   component owns it directly now, VirtualList.vue no longer wraps it. */
.message-virtual-list {
  @apply flex-1 min-h-0 overflow-auto;
}

.message-virtual-inner {
  @apply relative w-full;
}

.message-entry {
  @apply flex flex-col absolute top-0 left-0 w-full;
}

/* height (not padding) so this row's own rendered height stays exactly MESSAGE_ROW_HEIGHT
   (22px, the script's own numeric constant, kept equal to --kira-h-sm here) — VirtualList
   positions every row assuming that exact height, border included via box-sizing. */
.message-header {
  @apply box-border flex w-full items-center gap-1 border-0 border-b border-border bg-none px-1.5 font-[inherit] text-fg h-5.5 cursor-pointer;
}

.message-header:hover {
  @apply bg-hover;
}

/* Fixed height (not auto-grow) for the same reason .message-header's is — MUST stay numerically
   equal to the script's own MESSAGE_DETAIL_HEIGHT (200px); a JSON document taller than this
   scrolls inside MonacoHost's own scroller instead of growing the row. */
.message-detail {
  @apply box-border h-50 overflow-auto border-b border-border;
}

.metadata-groups {
  @apply flex flex-1 min-h-0 flex-col gap-2 overflow-auto p-1.5;
}

.metadata-group-title {
  @apply mb-0.5;
}

.history-hint-link {
  @apply mt-1 cursor-pointer border-0 bg-none p-0 text-kira-sm text-primary;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
.empty-state-icon {
  @apply text-subtle;
}
.empty-state-title {
  @apply text-kira-md text-muted font-normal;
}
</style>
