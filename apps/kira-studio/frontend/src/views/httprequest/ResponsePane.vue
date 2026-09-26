<script setup lang="ts">
import { type HttpResponsePane, statusClass, statusHint } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { registerCommand } from '@workbench/shortcuts/commands';
import { formatBytes } from '@workbench/util/format';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import { beautifyJson, beautifyXml } from '../../beautify';
import { DEFAULT_FIND_OPTIONS, type FindOptions, findRanges } from '../../editor/findRanges';
import MonacoHost from '../../editor/MonacoHost.vue';
import type { RangeHighlight } from '../../editor/ranges';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import ResponseFindBar, {
  type FindBarHost,
  type FindBarTarget,
} from '../shared/ResponseFindBar.vue';
import CookiesPane from './CookiesPane.vue';
import { useHttpHistoryStore } from './history';
import RawExchangePane from './RawExchangePane.vue';
import ResponseDiffDialog from './ResponseDiffDialog.vue';
import ResponseHistoryList from './ResponseHistoryList.vue';
import { useHttpRequestViewStore } from './state';
import TimelinePane from './TimelinePane.vue';

const props = defineProps<{ tab: HttpRequestTabRecord }>();
const httpRequestViewStore = useHttpRequestViewStore();
const httpHistoryStore = useHttpHistoryStore();

const rt = computed(() => httpRequestViewStore.runtime[props.tab.id]);
const historyRt = computed(() => httpHistoryStore.runtime[props.tab.id]);

// P8 C6/D12: the dialog mounts only while a compare is in flight — the same "reached only from an
// explicit click" gate that keeps Monaco's chunk unfetched (beyond whatever else on the page already needed it) until then (D13).
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
  httpHistoryStore.ensureHistoryFresh(props.tab.id);
});

// P8 D14/C5: Save as… adopts a scratch tab's history onto the newly-saved item (D14's `Adopt`
// call lives in http/state/collections.ts, which may not import views/** — biome.json — so the
// list's own refetch under the new scope happens reactively here instead, the moment
// tab.state.itemId actually changes). Entries are reset to null first so ensureHistoryFresh's
// own "already loaded" guard doesn't skip the refetch.
watch(
  () => props.tab.state.itemId,
  () => {
    const hrt = historyRt.value;
    if (hrt) hrt.entries = null;
    httpHistoryStore.ensureHistoryFresh(props.tab.id);
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

// P90 §3.2: sent + received, the Cookies segment's own count badge.
const responseCookiesCount = computed(
  () => (response.value?.sentCookies?.length ?? 0) + (response.value?.receivedCookies?.length ?? 0),
);

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

// P90 §3.2: the sixth segment, count-badged like REQUEST_PANE_OPTIONS's own Settings/Cookies
// entries — a computed array rather than the plain literal list above, since the label carries a
// count that changes with the response.
const RESPONSE_PANE_OPTIONS_WITH_COOKIES = computed(() => [
  ...RESPONSE_PANE_OPTIONS,
  {
    value: 'cookies' as const,
    label: responseCookiesCount.value > 0 ? `Cookies (${responseCookiesCount.value})` : 'Cookies',
    testid: 'http-response-pane-cookies',
  },
]);

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

// P21 round 2 performance finding 7: the previous shape (a round-2-review-finding-8 fix) cached
// jsonResult/xmlResult as their own computed()s so prettyFormat and bodyText below would share one
// parse instead of two — but a Vue computed retains whatever its arrow function *returns*, and
// beautifyJson/beautifyXml's return value is `{ text, ok, reason? }`: the full pretty-printed
// string, not just the boolean prettyFormat actually needed. Reading jsonResult.value.ok (from
// prettyFormat, on every render of the toolbar toggle) was therefore enough to keep the *entire*
// pretty-printed body — ~1.3x the raw body's own size, un-budgeted, on top of the raw body itself
// — retained for as long as `response` stayed the current one, including while Raw view is
// selected or a different pane entirely is showing. prettyFormat now only ever returns 'json' |
// 'xml' | null, so the large `.text` string beautifyJson/beautifyXml also compute is discarded the
// instant this computed's own function returns; bodyText below re-parses to get `.text` only when
// pretty view is the one actually being rendered, at the cost of a second parse in that case
// (bytewise no worse than the parse this file already ran per render before finding 8's own
// caching existed) in exchange for never retaining the pretty text outside that view.
const prettyFormat = computed<'json' | 'xml' | null>(() => {
  const body = response.value?.body;
  if (body === undefined) return null;
  if (beautifyJson(body, 'indented').ok) return 'json';
  // The `<…>` bracket check mirrors celleditor/detect.ts's own detectXml gate: an XML parse alone
  // accepts plain text with no tags at all (a valid, tag-less node list), so without it every
  // plain-text response would misreport as XML.
  const t = body.trim();
  if (t.length === 0 || t[0] !== '<' || t[t.length - 1] !== '>') return null;
  return beautifyXml(body, 'indented').ok ? 'xml' : null;
});

const RESPONSE_VIEW_OPTIONS = [
  { value: 'pretty' as const, label: 'Pretty', testid: 'http-response-view-pretty' },
  { value: 'raw' as const, label: 'Raw', testid: 'http-response-view-raw' },
];

function setResponseView(view: 'pretty' | 'raw'): void {
  patchHttpRequestTabState(props.tab.id, { responseView: view });
}

// P28 D1 reverses D11's "always shown inline, not tooltip-only": the standing caption under the
// status row was reported as noise. The hint is now the status chip's tooltip, which is what the
// four other consumers of `statusHint` in this app (ResponseHistoryList, ResponseDiffDialog,
// TimelinePane) have always done with it.
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
//
// Finding 7 (continued): this re-parses rather than reading a cached jsonResult/xmlResult, and
// deliberately so — this computed only ever runs (and only ever retains its own return value, the
// pretty string) while pretty view is the one actually selected, which is exactly the lifetime the
// pretty text should be retained for.
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
  httpHistoryStore.backToLatest(props.tab.id);
}

// P16 D12: the response headers pane's own filter — matches name OR value (unlike D14's
// variables filter, a header's value is the thing being hunted, is server-provided, and §5 shows
// it can never be a secret's plaintext). Component-local: a lens over what's on screen, not a
// setting — P24 D7's "a closed toolbar must never leave rows hidden with no visible cause" is
// satisfied trivially since the box is always visible while the pane is.
const headerFilter = ref('');
const filteredHeaders = computed(() => {
  const q = headerFilter.value.trim().toLowerCase();
  const all = response.value?.headers ?? [];
  if (!q) return all;
  return all.filter((h) => h.name.toLowerCase().includes(q) || h.value.toLowerCase().includes(q));
});

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
// P28 D11: the options object joins the exposed pair — the painted highlight has to use the same three
// toggles the bar counts and steps through, or the two disagree about what a match even is.
const findBarRef = ref<{
  query: string;
  currentGlobal: number;
  options: FindOptions;
} | null>(null);

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
// recomputes, and so each editor's `rangeHighlights` prop reference changes (MonacoHost's own
// watch on that prop is what triggers a repaint), exactly when the query or the current match does.
const perTargetHighlighters = computed<((doc: string) => readonly RangeHighlight[])[]>(() => {
  const bar = findBarRef.value;
  const query = bar?.query ?? '';
  const currentGlobal = bar?.currentGlobal ?? -1;
  const options = bar?.options ?? DEFAULT_FIND_OPTIONS;
  const targets = findTargets.value;
  if (!query) return targets.map(() => () => []);
  let cursor = 0;
  return targets.map((t) => {
    const localCurrent = currentGlobal - cursor;
    cursor += findRanges(t.doc, query, undefined, options).length;
    return (doc: string): readonly RangeHighlight[] =>
      findRanges(doc, query, localCurrent, options);
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
  <div class="flex h-full min-h-0 flex-col" data-testid="http-response-pane">
    <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="http-send-error">
      <AlertDescription>{{ rt.error.message }}</AlertDescription>
    </Alert>

    <div class="response-status-row h-bar shrink-0 flex items-center gap-1 px-2 border-b border-border">
      <template v-if="response">
        <Tooltip>
          <TooltipTrigger as-child>
            <Badge :variant="statusClass(response.status)" data-testid="http-status">
              {{ response.status }} {{ response.statusText }}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{{ hint }}</TooltipContent>
        </Tooltip>
        <span class="ml-auto" />
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="text-kira-md text-subtle cursor-pointer border-0 bg-none p-0 hover:text-fg"
              data-testid="http-elapsed"
              @click="viewTimeline"
            >
              {{ response.elapsedMs }} ms
            </button>
          </TooltipTrigger>
          <TooltipContent>See where the time went</TooltipContent>
        </Tooltip>
        <span class="text-kira-sm text-subtle" data-testid="http-body-bytes">{{ formatBytes(response.bodyBytes) }}</span>
        <ToggleGroup
          v-if="tab.state.responsePane === 'body' && prettyFormat"
          type="single"
          size="kira"
          :model-value="tab.state.responseView"
          data-testid="http-response-view-toggle"
          @update:model-value="(v) => v && setResponseView(v as 'pretty' | 'raw')"
        >
          <ToggleGroupItem v-for="opt in RESPONSE_VIEW_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </template>
      <span v-else class="ml-auto" />
      <!-- D11: only the two panes with a rangeHighlights compartment free (Body, Raw) get the
           find affordance — Headers has its own separate filter (D12), and History/Timeline are
           lists, not one searchable document. -->
      <TooltipIconButton
        v-if="tab.state.responsePane === 'body' || tab.state.responsePane === 'raw'"
        icon="search"
        label="Find in response"
        :class="{ 'bg-field text-fg': findOpen }"
        data-testid="http-find-toggle"
        @click="toggleFind"
      />
      <ToggleGroup
        type="single"
        size="kira"
        :model-value="tab.state.responsePane"
        data-testid="http-response-pane-toggle"
        @update:model-value="(v) => v && setResponsePane(v as HttpResponsePane)"
      >
        <ToggleGroupItem
          v-for="opt in RESPONSE_PANE_OPTIONS_WITH_COOKIES"
          :key="opt.value"
          :value="opt.value"
          :data-testid="opt.testid"
        >
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
    </div>

    <!-- Real-interaction fix (reported bug — the response search bar sat below/at the bottom of
         the response content instead of above it): the app's own established placement for a
         "search this content" bar — the SQL data view's SearchToolbar (DataView.vue's own
         `#strips` slot, docked "below the filter row, not floating over the grid it searches" —
         that same file's own comment records "the 'docks at the bottom of the result' placement
         ... overlapped the last visible row, which read as a bug rather than a search bar" and
         was rejected for exactly that reason), and the Mongo/documents view's SearchToolbar
         ("Below the filter/sort row, above the list it searches") — is directly below the toolbar
         it belongs to and above the content it searches, never below the content. This file's own
         previous placement (after the response body, right before ResponseDiffDialog) and
         ResponseFindBar.vue's own comment both cited "LAW 03: docks below the pane it searches" —
         backwards from what LAW 03 actually establishes everywhere else in this app, corrected
         here to match. -->
    <ResponseFindBar
      v-if="findOpen && (tab.state.responsePane === 'body' || tab.state.responsePane === 'raw')"
      ref="findBarRef"
      :targets="findTargets"
      @close="closeFind"
    />

    <Alert v-if="viewing" variant="note" data-testid="http-history-band">
      <AlertDescription class="flex items-start gap-1.5">
        <span>
          Viewing the response from {{ viewingTime }} · {{ viewing?.snapshot.entry.method }}
          {{ viewing?.snapshot.entry.url }}
        </span>
        <Button variant="toolbar" size="kira" class="ml-auto shrink-0" data-testid="http-history-back" @click="onBackToLatest">
          {{ rt?.response ? 'Back to latest' : 'Close' }}
        </Button>
      </AlertDescription>
    </Alert>

    <Alert v-if="response?.bodyTruncated" variant="warn" data-testid="http-body-truncated">
      <AlertDescription>
        Response truncated at {{ formatBytes(response.bodyBytes) }} — the server sent more than that.
      </AlertDescription>
    </Alert>
    <Alert v-if="bodyStorageTruncated" variant="note" data-testid="http-history-truncated">
      <AlertDescription>
        Only the first 256 KB of this response was kept in history.
      </AlertDescription>
    </Alert>
    <Alert v-if="bodyNotStored" variant="note" data-testid="http-history-binary-note">
      <AlertDescription>
        This response's body was binary and was not kept — {{ response ? formatBytes(response.bodyBytes) : '' }}.
      </AlertDescription>
    </Alert>
    <Tooltip v-if="redirectCaption">
      <TooltipTrigger as-child>
        <button
          type="button"
          class="text-kira-md text-subtle block w-full text-left cursor-pointer border-0 bg-none p-0 hover:text-fg"
          data-testid="http-redirects"
          @click="viewTimeline"
        >
          {{ redirectCaption }}
        </button>
      </TooltipTrigger>
      <TooltipContent>See where the time went</TooltipContent>
    </Tooltip>

    <ResponseHistoryList
      v-if="tab.state.responsePane === 'history'"
      :tab="tab"
      @compare="onCompare"
    />
    <div v-else-if="tab.state.responsePane === 'headers'" class="flex flex-1 min-h-0 flex-col" data-testid="http-response-headers">
      <template v-if="response">
        <InputGroup>
          <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
          <InputGroupInput v-model="headerFilter" placeholder="Filter headers" data-testid="http-response-headers-filter" />
          <InputGroupAddon v-if="headerFilter" align="inline-end">
            <InputGroupButton aria-label="Clear filter" @click="headerFilter = ''">
              <CodiconIcon name="close" :size="13" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <span
          v-if="headerFilter.trim()"
          class="text-kira-sm subtle px-1.5 pt-1 pb-0"
          data-testid="http-response-headers-count"
        >
          {{ filteredHeaders.length }} of {{ response.headers.length }} headers
        </span>
        <div class="flex flex-1 min-h-0 flex-col gap-0.5 overflow-auto p-1.5">
          <div v-for="(h, i) in filteredHeaders" :key="i" class="flex gap-1.5 text-kira-sm" data-testid="response-header-row">
            <span class="text-muted-foreground shrink-0 min-w-40 font-data">{{ h.name }}</span>
            <span class="wrap-anywhere font-data">{{ h.value }}</span>
          </div>
        </div>
      </template>
      <Empty v-else>
        <EmptyMedia><CodiconIcon name="arrow-right" :size="24" /></EmptyMedia>
        <EmptyTitle>Send a request to see the response</EmptyTitle>
      </Empty>
    </div>
    <RawExchangePane
      v-else-if="tab.state.responsePane === 'raw'"
      ref="rawPaneRef"
      :tab="tab"
      :request-highlights="rawRequestHighlights"
      :response-highlights="rawResponseHighlights"
    />
    <TimelinePane v-else-if="tab.state.responsePane === 'timeline'" :tab="tab" />
    <CookiesPane v-else-if="tab.state.responsePane === 'cookies'" mode="response" :response="response" />
    <div v-else class="response-body flex flex-1 min-h-0 flex-col">
      <template v-if="response">
        <span
          v-if="response.bodyEncoding === 'base64'"
          class="text-kira-sm text-muted-foreground p-1.5"
          data-testid="http-response-binary"
        >
          {{ response.bodyBytes }} bytes of binary data
        </span>
        <MonacoHost
          v-else
          ref="bodyHostRef"
          :doc="bodyText"
          :language="prettyFormat ?? 'plain'"
          :read-only="true"
          :range-highlights="bodyHighlights"
        />
      </template>
      <Empty v-else>
        <EmptyMedia><CodiconIcon name="arrow-right" :size="24" /></EmptyMedia>
        <EmptyTitle>Send a request to see the response</EmptyTitle>
        <button
          v-if="hasHistory"
          type="button"
          class="mt-1 cursor-pointer border-0 bg-none p-0 text-kira-md text-primary"
          data-testid="http-history-hint"
          @click="viewHistory"
        >
          {{ historyCount }} past response{{ historyCount === 1 ? '' : 's' }} · View history
        </button>
      </Empty>
    </div>

    <ResponseDiffDialog v-if="compareIds" :ids="compareIds" @close="closeCompare" />
    <!-- `.response-status-row`/`.response-body` stay bare markers (test locators).
         P110 I2-17: `.pane-jump-link:hover` moved onto each button's own `hover:text-fg` (a plain
         button reset rather than AppButton's own chrome, so the status row's look is unchanged) --
         no test locates by that class, so the marker drops. -->
  </div>
</template>
