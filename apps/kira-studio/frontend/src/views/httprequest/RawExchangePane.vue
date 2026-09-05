<script setup lang="ts">
import type { HttpWireFidelity } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { copyText } from '../../clipboard';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { RangeHighlight } from '../../editor/variableHighlight';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import { historyRuntime } from './history';
import type { FindBarHost } from './ResponseFindBar.vue';
import { runtime } from './state';

// P9 D12/D14/D15: the inspector — the SPEC's own "view the exact bytes sent and received", with
// its fidelity stated rather than assumed. F16: lives here (views/httprequest/), not http/, because
// it is mounted from inside ResponsePane.vue and needs CodeMirrorHost/theme/primitives.
const props = defineProps<{
  tab: HttpRequestTabRecord;
  /** P16 D11: ResponseFindBar's own painted matches for each of this pane's two documents — the
   *  bar itself has no template access to these editors, since they're this component's own
   *  children. Absent (no find bar open) paints nothing, same as every other rangeHighlights
   *  caller when its prop is absent. */
  requestHighlights?: (doc: string) => readonly RangeHighlight[];
  responseHighlights?: (doc: string) => readonly RangeHighlight[];
}>();

// P8 D10's own source swap, duplicated here rather than threaded down as props — the same
// "each pane computes its own runtime over the tab id" shape ResponseHistoryList.vue already
// uses, so a future pane needs no prop-plumbing change to this component's siblings.
const rt = computed(() => runtime[props.tab.id]);
const historyRt = computed(() => historyRuntime[props.tab.id]);
const viewingStored = computed(() => historyRt.value?.viewing ?? null);
const response = computed(
  () => viewingStored.value?.snapshot.response ?? rt.value?.response ?? null,
);
const wire = computed(() => response.value?.wire ?? null);

const FIDELITY_TEXT: Readonly<Record<HttpWireFidelity, string>> = {
  exact: 'These are the exact bytes this app wrote to the connection.',
  http2:
    'This exchange used HTTP/2 — its wire form is binary HPACK frames on a multiplexed connection. Shown here is the equivalent HTTP/1.1 form.',
  proxied:
    'This request went through an HTTP proxy, so its request line carried the absolute URL rather than the path shown. Everything else is exact.',
};
const fidelityText = computed(() => (wire.value ? FIDELITY_TEXT[wire.value.fidelity] : ''));
// D3 calls for an "info" tone on 'exact' — MessageStrip's own vocabulary (warn/err/note, no
// separate info) makes 'note' its informational tone (the same one the history viewing band uses),
// so 'exact' reuses it rather than widening a shared primitive for this one caller (§0.2/§3).
const fidelityTone = computed<'note' | 'warn'>(() =>
  wire.value?.fidelity === 'exact' ? 'note' : 'warn',
);

const maskingNote = computed(() => {
  const n = wire.value?.maskedSecrets ?? 0;
  if (n === 0) return '';
  const label = n === 1 ? 'value is' : 'values are';
  return `${n} secret ${label} shown as {{name}}. Use Copy as curl for a command with real values (authentication required).`;
});

const elisionNote = computed(() =>
  wire.value?.requestBodyElided
    ? 'The request body is shown in part — Content-Length above is the real one.'
    : '',
);

// D7: distinct from a live dump failure (D2) — a stored entry can never have a raw view at all,
// while a dump failure is this send's own, and is worth naming differently. A sentence belongs in
// a strip, a label belongs in a label (F13/D10) — so the terse label and the longer explanation
// are two separate computeds rather than one concatenated string.
const emptyLabel = computed(() => {
  if (!response.value) return '';
  if (wire.value) return '';
  return viewingStored.value
    ? 'No raw view for a stored response'
    : 'The raw exchange could not be rendered';
});
const emptyExplanation = computed(() => {
  if (!response.value || wire.value || !viewingStored.value) return '';
  return 'The raw exchange is kept only for the response currently in this tab.';
});

const requestCaption = computed(() => {
  const e = viewingStored.value?.snapshot.entry;
  if (e) return `→ ${e.method} ${e.url}`;
  const r = rt.value;
  return r ? '→ request' : '';
});

const responseText = computed(() => {
  const w = wire.value;
  const r = response.value;
  if (!w || !r) return '';
  return `${w.responseHead}\n${r.body}`;
});

function onCopyRequest(): void {
  if (wire.value) void copyText(wire.value.request);
}

function onCopyResponse(): void {
  void copyText(responseText.value);
}

// P16 D11: the two hosts and their docs, exposed for ResponsePane.vue's own find-bar targets
// (`targets: { doc, host }[]`) — `getDocs()` rather than exposed computed refs, since it's called
// from inside ResponsePane's own reactive computed (any reactive state it reads there is tracked
// exactly as if read directly, regardless of which component's function reads it).
const requestHostRef = ref<FindBarHost | null>(null);
const responseHostRef = ref<FindBarHost | null>(null);
defineExpose({
  requestHost: requestHostRef,
  responseHost: responseHostRef,
  getDocs: () => ({ request: wire.value?.request ?? '', response: responseText.value }),
});
</script>

<template>
  <div class="raw-exchange-pane" data-testid="http-raw-pane">
    <template v-if="wire">
      <MessageStrip :tone="fidelityTone" data-testid="http-wire-fidelity">
        {{ fidelityText }}
      </MessageStrip>
      <MessageStrip v-if="maskingNote" tone="note" data-testid="http-wire-masking-note">
        {{ maskingNote }}
      </MessageStrip>

      <div class="raw-section">
        <div class="raw-section-header">
          <span class="p-xs dim mono raw-caption" data-testid="http-wire-request-caption">
            {{ requestCaption }}
          </span>
          <span class="p-push" />
          <IconButton
            icon="copy"
            aria-label="Copy request"
            v-tooltip="'Copy request'"
            data-testid="http-wire-request-copy"
            @click="onCopyRequest"
          />
        </div>
        <MessageStrip v-if="elisionNote" tone="note" data-testid="http-wire-elision-note">
          {{ elisionNote }}
        </MessageStrip>
        <div class="raw-editor">
          <CodeMirrorHost
            ref="requestHostRef"
            :doc="wire.request"
            language="plain"
            :read-only="true"
            :range-highlights="requestHighlights"
            data-testid="http-wire-request-editor"
          />
        </div>
      </div>

      <div class="raw-section">
        <div class="raw-section-header">
          <span class="p-xs dim mono raw-caption">←</span>
          <span class="p-push" />
          <IconButton
            icon="copy"
            aria-label="Copy response"
            v-tooltip="'Copy response'"
            data-testid="http-wire-response-copy"
            @click="onCopyResponse"
          />
        </div>
        <div class="raw-editor">
          <CodeMirrorHost
            ref="responseHostRef"
            :doc="responseText"
            language="plain"
            :read-only="true"
            :range-highlights="responseHighlights"
            data-testid="http-wire-response-editor"
          />
        </div>
        <MessageStrip tone="note" data-testid="http-wire-order-note">
          Response headers are shown alphabetised and in canonical case — Go's HTTP client does not
          expose them in received order.
        </MessageStrip>
      </div>
    </template>

    <template v-else-if="emptyLabel">
      <MessageStrip v-if="emptyExplanation" tone="note" data-testid="http-raw-empty-note">
        {{ emptyExplanation }}
      </MessageStrip>
      <EmptyState icon="file-binary" :label="emptyLabel" />
    </template>
    <EmptyState v-else icon="arrow-right" label="Send a request to see the response" />
  </div>
</template>

<style scoped>
.raw-exchange-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
}

.raw-section {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  min-height: 200px;
}

.raw-section-header {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.raw-caption {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.raw-editor {
  flex: 1;
  min-height: 200px;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  overflow: hidden;
}
</style>
