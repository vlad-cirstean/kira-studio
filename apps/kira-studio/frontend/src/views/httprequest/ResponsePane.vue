<script setup lang="ts">
import { type HttpResponsePane, statusClass, statusHint } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, watch } from 'vue';
import { beautifyJson, beautifyXml, scanJson, scanXml } from '../../beautify';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { formatBytes } from '../../format';
import { patchHttpRequestTabState } from '../../state/tabs';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { backToLatest, ensureHistoryLoaded, historyRuntime } from './history';
import ResponseHistoryList from './ResponseHistoryList.vue';
import { runtime } from './state';

const props = defineProps<{ tab: HttpRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const historyRt = computed(() => historyRuntime[props.tab.id]);

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
];

// P8 C1: HttpResponsePane, not an inline 'body' | 'headers' literal — the schema is the source of
// truth for the pane vocabulary, so a widened schema (C4 adds 'history') can never desync from
// this handler's own type. RESPONSE_PANE_OPTIONS still lists only two entries until C4.
function setResponsePane(pane: HttpResponsePane): void {
  patchHttpRequestTabState(props.tab.id, { responsePane: pane });
}

function viewHistory(): void {
  setResponsePane('history');
}

// D12/C6/D13: scanJson/scanXml are the app's one "is this JSON"/"is this XML" gate (F13) — the
// Pretty/Raw toggle only exists when there is something to prettify. The `<…>` bracket check
// mirrors celleditor/detect.ts's own detectXml gate: scanXml alone accepts plain text with no
// tags at all (a valid, tag-less node list), so without it every plain-text response would
// misreport as XML.
const prettyFormat = computed<'json' | 'xml' | null>(() => {
  const body = response.value?.body;
  if (body === undefined) return null;
  if (scanJson(body).ok) return 'json';
  const t = body.trim();
  if (t.length > 0 && t[0] === '<' && t[t.length - 1] === '>' && scanXml(t).ok) return 'xml';
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
    if (prettyFormat.value === 'json') return beautifyJson(r.body, 'indented').text;
    if (prettyFormat.value === 'xml') return beautifyXml(r.body, 'indented').text;
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
</script>

<template>
  <div class="response-pane" data-testid="http-response-pane">
    <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="http-send-error">
      {{ rt.error.message }}
    </MessageStrip>

    <template v-if="response || hasHistory">
      <div class="response-status-row p-toolbar">
        <template v-if="response">
          <span class="p-chip" :class="statusClass(response.status)" data-testid="http-status">
            {{ response.status }} {{ response.statusText }}
          </span>
          <span class="p-xs muted status-hint" v-tooltip="hint" data-testid="http-status-hint">{{ hint }}</span>
          <span class="p-push" />
          <span class="p-xs dim" data-testid="http-elapsed">{{ response.elapsedMs }} ms</span>
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
        <SegmentedControl
          :model-value="tab.state.responsePane"
          :options="RESPONSE_PANE_OPTIONS"
          data-testid="http-response-pane-toggle"
          @update:model-value="setResponsePane"
        />
      </div>

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
      <div v-if="redirectCaption" class="p-xs dim redirect-caption" data-testid="http-redirects">
        {{ redirectCaption }}
      </div>

      <ResponseHistoryList v-if="tab.state.responsePane === 'history'" :tab="tab" />
      <div v-else-if="tab.state.responsePane === 'headers'" class="response-headers" data-testid="http-response-headers">
        <template v-if="response">
          <div v-for="(h, i) in response.headers" :key="i" class="response-header-row">
            <span class="header-name mono">{{ h.name }}</span>
            <span class="header-value mono">{{ h.value }}</span>
          </div>
        </template>
        <EmptyState v-else icon="arrow-right" label="Send a request to see the response" />
      </div>
      <div v-else class="response-body">
        <template v-if="response">
          <span
            v-if="response.bodyEncoding === 'base64'"
            class="p-sm muted binary-note"
            data-testid="http-response-binary"
          >
            {{ response.bodyBytes }} bytes of binary data
          </span>
          <CodeMirrorHost v-else :doc="bodyText" :language="prettyFormat ?? 'plain'" :read-only="true" />
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
    </template>

    <EmptyState v-else-if="!rt || rt.status === 'idle'" icon="arrow-right" label="Send a request to see the response" />
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

.redirect-caption {
  padding: var(--kira-s-2) var(--kira-s-3);
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

.response-header-row {
  display: flex;
  gap: var(--kira-s-3);
  font-size: var(--kira-t-xs);
}

.header-name {
  color: var(--kira-fg-muted);
  flex-shrink: 0;
  min-width: 160px;
}

.header-value {
  overflow-wrap: anywhere;
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
