<script setup lang="ts">
import { type HttpResponsePane, statusClass, statusHint } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import { beautifyJson, beautifyXml } from '../../beautify';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { findRanges } from '../../editor/findRanges';
import type { RangeHighlight } from '../../editor/variableHighlight';
import { formatBytes } from '../../format';
import { registerCommand } from '../../shortcuts/commands';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { backToLatest, ensureHistoryLoaded, historyRuntime } from './history';
import RawExchangePane from './RawExchangePane.vue';
import ResponseDiffDialog from './ResponseDiffDialog.vue';
import ResponseFindBar, { type FindBarHost, type FindBarTarget } from './ResponseFindBar.vue';
import ResponseHistoryList from './ResponseHistoryList.vue';
import { runtime } from './state';
import TimelinePane from './TimelinePane.vue';

const props = defineProps<{ tab: HttpRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const historyRt = computed(() => historyRuntime[props.tab.id]);

// P8 C6/D12: the dialog mounts only while a compare is in flight — the same "reached only from an
// explicit click" gate that keeps @codemirror/merge's chunk unfetched until then (D13).
const compareIds = ref<[string, string] | null>(null);
function onCompare(ids: [string, string]): void {
  compareIds.value = ids;
}
function closeCompare(): void {
  compareIds.value = null;
}

// P8 D11: the one initial "does this tab have any history at all" fetch — always, on mount,
// regardless of the live response or which pane is selected (F9's sibling reasoning). This is
// what lets a restored tab (no live response, D10) still say "N past responses".
onMounted(() => {
  ensureHistoryLoaded(props.tab.id);
});

// P8 D14/C5: Save as… adopts a scratch tab's history onto the newly-saved item (D14's `Adopt`
// call lives in http/state/collections.ts, which may not import views/** — biome.json — so the
// list's own refetch under the new scope happens reactively here instead, the moment
// tab.state.itemId actually changes). Entries are reset to null first so ensureHistoryLoaded's
// own "already loaded" guard doesn't skip the refetch.
watch(
  () => props.tab.state.itemId,
  () => {
    const hrt = historyRt.value;
    if (hrt) hrt.entries = null;
    ensureHistoryLoaded(props.tab.id);
  },
);

// P8 D10: the source swap — a selected history entry's response, or the live one, or none. Every
// consumer below (the status chip, the hint, elapsed/bytes, the redirect caption, the truncation
// strip, the headers list, the binary note, prettyFormat, bodyText) reads only this one object,
// unchanged from before this phase.
const viewing = computed(() => historyRt.value?.viewing ?? null);
const response = computed(() => viewing.value?.snapshot.response ?? rt.value?.response ?? null);

const hasHistory = computed(() => (historyRt.value?.entries?.length ?? 0) > 0);
const historyCount = computed(() => historyRt.value?.entries?.length ?? 0);

const RESPONSE_PANE_OPTIONS = [
  { value: 'body' as const, label: 'Body', testid: 'http-response-pane-body' },
  { value: 'headers' as const, label: 'Headers', testid: 'http-response-pane-headers' },
  { value: 'history' as const, label: 'History', testid: 'http-response-pane-history' },
  // P9 D12/F19: the fourth segment — never on screen at the same time as the body's own Pretty/Raw
  // toggle (gated on responsePane === 'body' below), so the shared "Raw" label never collides.
  { value: 'raw' as const, label: 'Raw', testid: 'http-response-pane-raw' },
  // P10 D11/F19: the fifth segment — where the time went, per hop.
  { value: 'timeline' as const, label: 'Timeline', testid: 'http-response-pane-timeline' },
];

// P8 C1: HttpResponsePane, not an inline 'body' | 'headers' literal — the schema is the source of
// truth for the pane vocabulary, so a widened schema (P8 adds 'history', P9 adds 'raw') can never
// desync from this handler's own type.
function setResponsePane(pane: HttpResponsePane): void {
  patchHttpRequestTabState(props.tab.id, { responsePane: pane });
}

function viewHistory(): void {
  setResponsePane('history');
}

// D11: the two dead-end summaries become the way in to Timeline — the user who wonders about a
// number clicks *that number*, rather than hunting for a fifth segment among five.
function viewTimeline(): void {
  setResponsePane('timeline');
}

// Round-2 review finding 8: beautifyJson/beautifyXml run the exact same parse scanJson/scanXml
// would (both are `tryParseJson`/`tryParseXml` themselves, D10) — computed here once and reused by
// both prettyFormat (the `ok` flag) and bodyText below (the `text` output), instead of parsing the
// same body twice per render to answer a boolean and then again for the real output. The `<…>`
// bracket check mirrors celleditor/detect.ts's own detectXml gate: an XML parse alone accepts
// plain text with no tags at all (a valid, tag-less node list), so without it every plain-text
// response would misreport as XML; xmlResult is skipped entirely once JSON already matched.
const jsonResult = computed(() => {
  const body = response.value?.body;
  return body === undefined ? null : beautifyJson(body, 'indented');
});
const xmlResult = computed(() => {
  const body = response.value?.body;
  if (body === undefined || jsonResult.value?.ok) return null;
  const t = body.trim();
  if (t.length === 0 || t[0] !== '<' || t[t.length - 1] !== '>') return null;
  return beautifyXml(body, 'indented');
});
const prettyFormat = computed<'json' | 'xml' | null>(() => {
  if (jsonResult.value?.ok) return 'json';
  if (xmlResult.value?.ok) return 'xml';
  return null;
});

const RESPONSE_VIEW_OPTIONS = [
  { value: 'pretty' as const, label: 'Pretty', testid: 'http-response-view-pretty' },
  { value: 'raw' as const, label: 'Raw', testid: 'http-response-view-raw' },
];

function setResponseView(view: 'pretty' | 'raw'): void {
  patchHttpRequestTabState(props.tab.id, { responseView: view });
}

// D11: the hint is always shown inline, not tooltip-only — the case that matters (4xx/5xx) is
// exactly the case where the user should not have to discover a hover. `v-tooltip` still carries
// the full sentence for when the caption itself is truncated by the row's width.
const hint = computed(() => (response.value ? statusHint(response.value.status) : ''));

const redirectCaption = computed(() => {
  const r = response.value;
  if (!r || r.redirects.length === 0) return '';
  const n = r.redirects.length;
  return `${n} redirect${n === 1 ? '' : 's'} → ${r.finalUrl}`;
});

// D12/D13: a view toggle, never an edit — Pretty renders beautifyJson/beautifyXml(raw, 'indented')
// depending on prettyFormat, Raw renders the bytes exactly as received. Neither ever mutates
// response.body itself (it is read-only runtime state, D6), so switching back to Raw always shows
// what the server actually sent.
const bodyText = computed(() => {
  const r = response.value;
  if (!r) return '';
  if (props.tab.state.responseView === 'pretty') {
    if (prettyFormat.value === 'json') return jsonResult.value?.text ?? r.body;
    if (prettyFormat.value === 'xml') return xmlResult.value?.text ?? r.body;
  }
  return r.body;
});

// P8 D10: the two storage notices — only meaningful while viewing a stored entry (the live
// response carries neither flag). Separate from, and additional to, bodyTruncated's own transfer
// message (F9) — one is about the transfer, the other about what history chose to keep.
const bodyStorageTruncated = computed(() => viewing.value?.snapshot.bodyStorageTruncated ?? false);
const bodyNotStored = computed(() => (viewing.value ? !viewing.value.snapshot.bodyStored : false));

const viewingTime = computed(() => {
  const iso = viewing.value?.snapshot.entry.sentAt;
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour12: false });
});

function onBackToLatest(): void {
  backToLatest(props.tab.id);
}

// P16 D11: the find bar over the response body and the raw exchange's two documents. Component-
// local (not tab state, D11's own note): a lens over what's already on screen, not a setting.
const findOpen = ref(false);
function toggleFind(): void {
  findOpen.value = !findOpen.value;
}
function closeFind(): void {
  findOpen.value = false;
}

const bodyHostRef = ref<FindBarHost | null>(null);
const rawPaneRef = ref<{
  requestHost: FindBarHost | null;
  responseHost: FindBarHost | null;
  getDocs: () => { request: string; response: string };
} | null>(null);
const findBarRef = ref<{ query: string; currentGlobal: number } | null>(null);

// D11: one target for the Body pane, two (request wire, response wire) for the Raw pane — the
// only two panes with a `rangeHighlights` compartment free (F12: the request body's own is taken
// by P15b's {{variable}} colouring).
const findTargets = computed<readonly FindBarTarget[]>(() => {
  if (!findOpen.value) return [];
  if (props.tab.state.responsePane === 'body') {
    return [{ doc: bodyText.value, host: bodyHostRef.value }];
  }
  if (props.tab.state.responsePane === 'raw') {
    const docs = rawPaneRef.value?.getDocs();
    if (!docs) return [];
    return [
      { doc: docs.request, host: rawPaneRef.value?.requestHost ?? null },
      { doc: docs.response, host: rawPaneRef.value?.responseHost ?? null },
    ];
  }
  return [];
});

// Paints exactly the matches the bar itself counts and steps through, onto whichever editor(s)
// are actually on screen. Reads `findBarRef`'s exposed `query`/`currentGlobal` (and `findTargets`)
// synchronously in this computed's own evaluation — not inside the closures it returns — so this
// recomputes, and so each editor's `rangeHighlights` prop reference changes (CodeMirrorHost's own
// watch on that prop is what triggers a repaint), exactly when the query or the current match does.
const perTargetHighlighters = computed<((doc: string) => readonly RangeHighlight[])[]>(() => {
  const bar = findBarRef.value;
  const query = bar?.query ?? '';
  const currentGlobal = bar?.currentGlobal ?? -1;
  const targets = findTargets.value;
  if (!query) return targets.map(() => () => []);
  let cursor = 0;
  return targets.map((t) => {
    const localCurrent = currentGlobal - cursor;
    cursor += findRanges(t.doc, query).length;
    return (doc: string): readonly RangeHighlight[] => findRanges(doc, query, localCurrent);
  });
});
const bodyHighlights = computed(() => perTargetHighlighters.value[0]);
const rawRequestHighlights = computed(() => perTargetHighlighters.value[0]);
const rawResponseHighlights = computed(() => perTargetHighlighters.value[1]);

let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  // D11: opened from the response status row's own search button, and by view.find — mirrors
  // DataView.vue's own registration, mounted only while this tab is the active one.
  unregisterCommands = [registerCommand('view.find', toggleFind)];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <div class="response-pane" data-testid="http-response-pane">
    <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="http-send-error">
      {{ rt.error.message }}
    </MessageStrip>

    <div class="response-status-row p-toolbar">
      <template v-if="response">
        <span class="p-chip" :class="statusClass(response.status)" data-testid="http-status">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span class="p-push" />
        <button
          type="button"
          class="p-xs dim pane-jump-link"
          data-testid="http-elapsed"
          v-tooltip="'See where the time went'"
          @click="viewTimeline"
        >
          {{ response.elapsedMs }} ms
        </button>
        <span class="p-xs dim" data-testid="http-body-bytes">{{ formatBytes(response.bodyBytes) }}</span>
        <SegmentedControl
          v-if="tab.state.responsePane === 'body' && prettyFormat"
          :model-value="tab.state.responseView"
          :options="RESPONSE_VIEW_OPTIONS"
          data-testid="http-response-view-toggle"
          @update:model-value="setResponseView"
        />
      </template>
      <span v-else class="p-push" />
      <!-- D11: only the two panes with a rangeHighlights compartment free (Body, Raw) get the
           find affordance — Headers has its own separate filter (D12), and History/Timeline are
           lists, not one searchable document. -->
      <IconButton
        v-if="tab.state.responsePane === 'body' || tab.state.responsePane === 'raw'"
        icon="search"
        :active="findOpen"
        v-tooltip="'Find in response'"
        data-testid="http-find-toggle"
        @click="toggleFind"
      />
      <SegmentedControl
        :model-value="tab.state.responsePane"
        :options="RESPONSE_PANE_OPTIONS"
        data-testid="http-response-pane-toggle"
        @update:model-value="setResponsePane"
      />
    </div>

    <div v-if="hint" class="p-sm muted status-hint" data-testid="http-status-hint">{{ hint }}</div>

    <MessageStrip v-if="viewing" tone="note" data-testid="http-history-band">
      Viewing the response from {{ viewingTime }} · {{ viewing?.snapshot.entry.method }}
      {{ viewing?.snapshot.entry.url }}
      <AppButton class="strip-action" data-testid="http-history-back" @click="onBackToLatest">
        {{ rt?.response ? 'Back to latest' : 'Close' }}
      </AppButton>
    </MessageStrip>

    <MessageStrip v-if="response?.bodyTruncated" tone="warn" data-testid="http-body-truncated">
      Response truncated at {{ formatBytes(response.bodyBytes) }} — the server sent more than that.
    </MessageStrip>
    <MessageStrip v-if="bodyStorageTruncated" tone="note" data-testid="http-history-truncated">
      Only the first 256 KB of this response was kept in history.
    </MessageStrip>
    <MessageStrip v-if="bodyNotStored" tone="note" data-testid="http-history-binary-note">
      This response's body was binary and was not kept — {{ response ? formatBytes(response.bodyBytes) : '' }}.
    </MessageStrip>
    <button
      v-if="redirectCaption"
      type="button"
      class="p-xs dim redirect-caption pane-jump-link"
      data-testid="http-redirects"
      v-tooltip="'See where the time went'"
      @click="viewTimeline"
    >
      {{ redirectCaption }}
    </button>

    <ResponseHistoryList
      v-if="tab.state.responsePane === 'history'"
      :tab="tab"
      @compare="onCompare"
    />
    <div v-else-if="tab.state.responsePane === 'headers'" class="response-headers" data-testid="http-response-headers">
      <template v-if="response">
        <div v-for="(h, i) in response.headers" :key="i" class="p-kv-row">
          <span class="p-kv-name mono">{{ h.name }}</span>
          <span class="p-kv-value mono">{{ h.value }}</span>
        </div>
      </template>
      <EmptyState v-else icon="arrow-right" label="Send a request to see the response" />
    </div>
    <RawExchangePane
      v-else-if="tab.state.responsePane === 'raw'"
      ref="rawPaneRef"
      :tab="tab"
      :request-highlights="rawRequestHighlights"
      :response-highlights="rawResponseHighlights"
    />
    <TimelinePane v-else-if="tab.state.responsePane === 'timeline'" :tab="tab" />
    <div v-else class="response-body">
      <template v-if="response">
        <span
          v-if="response.bodyEncoding === 'base64'"
          class="p-sm muted binary-note"
          data-testid="http-response-binary"
        >
          {{ response.bodyBytes }} bytes of binary data
        </span>
        <CodeMirrorHost
          v-else
          ref="bodyHostRef"
          :doc="bodyText"
          :language="prettyFormat ?? 'plain'"
          :read-only="true"
          :range-highlights="bodyHighlights"
        />
      </template>
      <EmptyState v-else icon="arrow-right" label="Send a request to see the response">
        <button
          v-if="hasHistory"
          type="button"
          class="history-hint-link"
          data-testid="http-history-hint"
          @click="viewHistory"
        >
          {{ historyCount }} past response{{ historyCount === 1 ? '' : 's' }} · View history
        </button>
      </EmptyState>
    </div>

    <!-- D11: docked below the pane it searches (LAW 03), not floating over it. -->
    <ResponseFindBar
      v-if="findOpen && (tab.state.responsePane === 'body' || tab.state.responsePane === 'raw')"
      ref="findBarRef"
      :targets="findTargets"
      @close="closeFind"
    />

    <ResponseDiffDialog v-if="compareIds" :ids="compareIds" @close="closeCompare" />
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
  padding: 0 var(--kira-s-3) var(--kira-s-2);
}

.redirect-caption {
  display: block;
  width: 100%;
  padding: var(--kira-s-2) var(--kira-s-3);
  text-align: left;
}

/* D11: http-elapsed and http-redirects, still the same dim text they always were, now clickable —
   a plain button reset rather than AppButton's own chrome, so the status row's look is unchanged. */
.pane-jump-link {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  cursor: pointer;
}

.pane-jump-link:hover {
  color: var(--kira-fg);
}

.response-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.binary-note {
  padding: var(--kira-s-3);
}

.response-headers {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
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
