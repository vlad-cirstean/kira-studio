<script setup lang="ts">
import { defaultContentTypeFor, generateRawRequestFromStored } from '@kira/api-core';
import type { HttpCodeLanguage, HttpResponseWire, HttpWireFidelity } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { copyText } from '@workbench/util/clipboard';
import { computed, ref } from 'vue';
import MonacoHost from '../../editor/MonacoHost.vue';
import type { RangeHighlight } from '../../editor/ranges';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import type { FindBarHost } from '../shared/ResponseFindBar.vue';
import { useHttpHistoryStore } from './history';
import { useHttpRequestViewStore } from './state';

// P9 D12/D14/D15: the inspector — the SPEC's own "view the exact bytes sent and received", with
// its fidelity stated rather than assumed. F16: lives here (views/httprequest/), not http/, because
// it is mounted from inside ResponsePane.vue and needs MonacoHost/theme/primitives.
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
const httpRequestViewStore = useHttpRequestViewStore();
const httpHistoryStore = useHttpHistoryStore();
const rt = computed(() => httpRequestViewStore.runtime[props.tab.id]);
const historyRt = computed(() => httpHistoryStore.runtime[props.tab.id]);
const viewingStored = computed(() => historyRt.value?.viewing ?? null);
const response = computed(
  () => viewingStored.value?.snapshot.response ?? rt.value?.response ?? null,
);
const wire = computed(() => response.value?.wire ?? null);

// P18 D8: a stored entry never has a `wire` (P9 D7 nulls it before persisting), which is why the
// Raw segment used to render nothing at all while viewing one — the stored request/response are
// sitting right there in the snapshot with nothing rendering either. This reconstructs both
// documents from the four fields the snapshot actually carries, generated in the renderer rather
// than stored (P9 D7's own objection — storing rendered text would double a snapshot — does not
// apply here: nothing new is stored, only computed from what already is).
const showReconstructed = computed(() => !wire.value && !!viewingStored.value);

const storedRequestText = computed(() => {
  const req = viewingStored.value?.snapshot.request;
  if (!req) return '';
  // req.body.codeLanguage is the wire's plain `string` (HttpBodyWire), not the narrow
  // HttpCodeLanguage union tab state carries — this is this app's own stored data, always one of
  // the four, so the cast is safe (defaultContentTypeFor's Record falls back to undefined -> ''
  // for anything else, the same as an unset content type).
  return generateRawRequestFromStored(
    req,
    defaultContentTypeFor(req.body.mode, req.body.codeLanguage as HttpCodeLanguage),
  );
});

function buildResponseHead(r: HttpResponseWire): string {
  const lines = [`${r.proto} ${r.status} ${r.statusText}`];
  for (const h of r.headers) lines.push(`${h.name}: ${h.value}`);
  return lines.join('\n');
}

const storedResponseText = computed(() => {
  if (!showReconstructed.value || !response.value) return '';
  return `${buildResponseHead(response.value)}\n\n${response.value.body}`;
});

// P18 D8: requestBodyStorageTruncated finally gets a reader (F8) — this is the one place a
// stored entry's request can be seen at all, so it is also the one place this flag can be shown.
const requestBodyStorageTruncated = computed(
  () => viewingStored.value?.snapshot.requestBodyStorageTruncated ?? false,
);

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

// D7/D8: a live dump failure is this send's own — the only case left with no raw view at all,
// now that a stored entry always gets the reconstruction (F7: the request side is always stored).
const emptyLabel = computed(() => {
  if (!response.value || wire.value || showReconstructed.value) return '';
  return 'The raw exchange could not be rendered';
});

const requestCaption = computed(() => {
  const e = viewingStored.value?.snapshot.entry;
  if (e) return `→ ${e.method} ${e.url}`;
  const r = rt.value;
  return r ? '→ request' : '';
});

// D8: the unified document each editor renders — the live wire's own text, or the reconstruction,
// so the rest of the template (copy buttons, find-bar targets) reads one source regardless.
const requestText = computed(() => wire.value?.request ?? storedRequestText.value);
const responseText = computed(() => {
  if (wire.value && response.value) return `${wire.value.responseHead}\n${response.value.body}`;
  return storedResponseText.value;
});

function onCopyRequest(): void {
  void copyText(requestText.value);
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
  getDocs: () => ({ request: requestText.value, response: responseText.value }),
});

// P107 I2-38: the wire and reconstructed branches rebuilt the same request/response section
// markup — one v-for over this instead. noteBefore/noteAfter are '' outside the `wire` branch
// (the reconstructed branch shows neither the elision nor the order note, exactly as before).
interface RawSection {
  key: 'request' | 'response';
  caption: string;
  captionTestid?: string;
  copyLabel: string;
  copyTestid: string;
  onCopy: () => void;
  doc: string;
  highlights?: (doc: string) => readonly RangeHighlight[];
  editorTestid: string;
  noteBefore: string;
  noteBeforeTestid?: string;
  noteAfter: string;
  noteAfterTestid?: string;
}

const rawSections = computed<RawSection[]>(() => [
  {
    key: 'request',
    caption: requestCaption.value,
    captionTestid: 'http-wire-request-caption',
    copyLabel: 'Copy request',
    copyTestid: 'http-wire-request-copy',
    onCopy: onCopyRequest,
    doc: requestText.value,
    highlights: props.requestHighlights,
    editorTestid: 'http-wire-request-editor',
    noteBefore: wire.value ? elisionNote.value : '',
    noteBeforeTestid: 'http-wire-elision-note',
    noteAfter: '',
  },
  {
    key: 'response',
    caption: '←',
    copyLabel: 'Copy response',
    copyTestid: 'http-wire-response-copy',
    onCopy: onCopyResponse,
    doc: responseText.value,
    highlights: props.responseHighlights,
    editorTestid: 'http-wire-response-editor',
    noteBefore: '',
    noteAfter: wire.value
      ? "Response headers are shown alphabetised and in canonical case — Go's HTTP client does not expose them in received order."
      : '',
    noteAfterTestid: 'http-wire-order-note',
  },
]);

function setHostRef(key: RawSection['key'], instance: unknown): void {
  const host = instance as FindBarHost | null;
  if (key === 'request') requestHostRef.value = host;
  else responseHostRef.value = host;
}
</script>

<template>
  <div class="raw-exchange-pane" data-testid="http-raw-pane">
    <template v-if="wire || showReconstructed">
      <template v-if="wire">
        <Alert :class="fidelityTone === 'warn' ? 'strip-warn' : 'strip-note'" data-testid="http-wire-fidelity">
          <AlertDescription :class="fidelityTone === 'warn' ? 'strip-warn-text' : 'strip-note-text'">{{ fidelityText }}</AlertDescription>
        </Alert>
        <Alert v-if="maskingNote" class="strip-note" data-testid="http-wire-masking-note">
          <AlertDescription class="strip-note-text">{{ maskingNote }}</AlertDescription>
        </Alert>
      </template>
      <!-- P18 D8: a stored entry's Raw pane, reconstructed from the four stage-1 fields the
           snapshot carries rather than a live `wire` dump (which P9 D7 never stores). Not claimed
           as one of P9 D3's three HttpWireFidelity values — a reconstruction is none of them — so
           this gets its own honest strip rather than a fourth, misleading fidelity value. -->
      <template v-else>
        <Alert class="strip-note" data-testid="http-raw-reconstructed">
          <AlertDescription class="strip-note-text">
            Reconstructed from what this request was recorded as — not the exact bytes on the wire.
          </AlertDescription>
        </Alert>
        <Alert v-if="requestBodyStorageTruncated" class="strip-note" data-testid="http-history-request-truncated">
          <AlertDescription class="strip-note-text">
            Only the first 256 KB of this request's body was kept in history.
          </AlertDescription>
        </Alert>
      </template>

      <template v-for="section in rawSections" :key="section.key">
        <div class="raw-section">
          <div class="raw-section-header">
            <span class="p-xs dim mono raw-caption" :data-testid="section.captionTestid">
              {{ section.caption }}
            </span>
            <span class="p-push" />
            <Tooltip>
              <TooltipTrigger as-child>
                <Button variant="toolbar" size="kira-icon" :aria-label="section.copyLabel" :data-testid="section.copyTestid" @click="section.onCopy">
                  <CodiconIcon name="copy" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ section.copyLabel }}</TooltipContent>
            </Tooltip>
          </div>
          <Alert v-if="section.noteBefore" class="strip-note" :data-testid="section.noteBeforeTestid">
            <AlertDescription class="strip-note-text">{{ section.noteBefore }}</AlertDescription>
          </Alert>
          <div class="raw-editor">
            <MonacoHost
              :ref="(el) => setHostRef(section.key, el)"
              :doc="section.doc"
              language="plain"
              :read-only="true"
              :range-highlights="section.highlights"
              :data-testid="section.editorTestid"
            />
          </div>
          <Alert v-if="section.noteAfter" class="strip-note" :data-testid="section.noteAfterTestid">
            <AlertDescription class="strip-note-text">{{ section.noteAfter }}</AlertDescription>
          </Alert>
        </div>
      </template>
    </template>

    <template v-else-if="emptyLabel">
      <Alert class="empty-state">
        <CodiconIcon name="file-binary" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted font-normal">{{ emptyLabel }}</AlertTitle>
      </Alert>
    </template>
    <Alert v-else class="empty-state">
      <CodiconIcon name="arrow-right" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted font-normal">Send a request to see the response</AlertTitle>
    </Alert>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.raw-exchange-pane {
  @apply flex flex-1 min-h-0 flex-col gap-1 overflow-auto p-1.5;
}

.raw-section {
  @apply flex min-h-52 flex-col gap-0.5;
}

.raw-section-header {
  @apply flex items-center gap-1;
}

.raw-caption {
  @apply overflow-hidden text-ellipsis whitespace-nowrap;
}

.raw-editor {
  @apply flex-1 min-h-52 overflow-hidden rounded-kira border border-border;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}

/* Alert tone classes replacing the raw MessageStrip note/warn markers (now --kira-warn-
   text/--kira-note-text in tokens.css, promoted off this rule's literal-hex carve-out). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-note-text;
}
.strip-warn {
  @apply bg-warn/10 border-warn/20;
}
.strip-warn-text {
  @apply text-warn-text;
}
</style>
