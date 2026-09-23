<script setup lang="ts">
import {
  bodyBadgeLabel,
  canEditAsRaw,
  defaultContentTypeFor,
  generateRawRequest,
  httpRequestTitle,
  isDirty,
  isDynamicName,
  isFakeName,
  looksLikeCurlCommand,
  parseQuery,
  splitUrl,
  toSavedRequest,
} from '@kira/api-core';
import { type HttpMethod, type HttpRequestPane, httpMethodToken } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { registerCommand } from '@workbench/shortcuts/commands';
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import EnvironmentSelect from '../../api/EnvironmentSelect.vue';
import MethodSelect from '../../api/MethodSelect.vue';
import { useCollectionsStore } from '../../api/state/collections';
import { applyCurlToTab, useCopyAsCurlStore } from '../../api/state/curl';
import { useEditRawStore } from '../../api/state/raw';
import { variableSupport } from '../../api/state/variableCompletion';
import { useVariableSetStore, useVariablesStore } from '../../api/state/variables';
import { patchHttpRequestTabState } from '../../api/tabs';
import VariablesOverviewPanel from '../../api/VariablesOverviewPanel.vue';
import { DEFAULT_FIND_OPTIONS, type FindOptions, findRanges } from '../../editor/findRanges';
import type { RangeHighlight } from '../../editor/ranges';
import { useConnectionsStore } from '../../state/connections';
import { useRunState } from '../../state/runState';
import { useSettingsStore } from '../../state/settings';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import { useTabIncognitoStore } from '../../state/tabIncognito';
import { templateToken } from '../../theme/completion';
import AutocompleteField from '../shared/AutocompleteField.vue';
import ResponseFindBar, {
  type FindBarHost,
  type FindBarTarget,
} from '../shared/ResponseFindBar.vue';
import CookiesPane from './CookiesPane.vue';
import { useCookiesStore } from './cookies';
import QueryParamsTable from './QueryParamsTable.vue';
import RequestBodyPane from './RequestBodyPane.vue';
import RequestHeadersTable from './RequestHeadersTable.vue';
import RequestSettingsPane from './RequestSettingsPane.vue';
import ResponsePane from './ResponsePane.vue';
import { onSendCompleted, resolveForExport, resolveTabState, useHttpRequestViewStore } from './state';

// MainView.vue keys this component by tab.id — same discipline as every other *View.vue.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

const tabIncognitoStore = useTabIncognitoStore();
const editRawStore = useEditRawStore();
const collectionsStore = useCollectionsStore();
const copyAsCurlStore = useCopyAsCurlStore();
const variablesStore = useVariablesStore();
const variableSetStore = useVariableSetStore();
const cookiesStore = useCookiesStore();
const settingsStore = useSettingsStore();
const httpRequestViewStore = useHttpRequestViewStore();
const connectionsStore = useConnectionsStore();

const rt = computed(() => httpRequestViewStore.runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');

const title = computed(() => httpRequestTitle(props.tab.state));

// P104 §3: ViewChrome/ViewHeader/RunState inlined at this call site (no library counterpart).
const envColor = computed(() => variablesStore.environmentColorForTab(props.tab.id));
const connRecord = computed(() => connectionsStore.connectionRecord(props.tab.connectionId));
const railColor = computed(() =>
  envColor.value !== undefined
    ? envColor.value
    : connRecord.value
      ? (connRecord.value.color ?? null)
      : undefined,
);
const runState = useRunState(() => props.tab.id);
const runStateLabel = computed(() => {
  if (runState.value.status === 'error') return 'failed';
  if (runState.value.elapsedMs === null) return '—';
  return runState.value.elapsedMs < 1000
    ? `${Math.round(runState.value.elapsedMs)} ms`
    : `${(runState.value.elapsedMs / 1000).toFixed(1)} s`;
});

// P71 §5/§3.1: the tab's own incognito state, and the per-tab environment id it reads through
// while incognito (api/state/variables.ts's own override) — every other caller of
// collectionId/environmentId in this file goes through envId, never activeEnvironmentId directly.
const incognito = computed(() => tabIncognitoStore.isIncognito(props.tab.id));
function toggleIncognito(): void {
  tabIncognitoStore.setIncognito(props.tab.id, !incognito.value);
}
const envId = computed(() => variablesStore.environmentIdForTab(props.tab.id));

// D12/P17 D19: a method chip coloured per-method (not per-family any more — httpMethodToken
// replaces httpMethodClass outright, F13/D19), over .p-method's new tinted-background rule. P4
// D16's own reasoning still holds: the map lives in the shared domain beside statusClass, since
// the collections tree's own row needs it too and `http/**` may not import `views/**`.
const methodToken = computed(() => httpMethodToken(props.tab.state.method));

function onMethodChange(method: HttpMethod): void {
  patchHttpRequestTabState(props.tab.id, { method });
}

// P28 D11: the request panel's own half of the find bar. The bar itself is hoisted above the
// request/response split (template below) and asks which panel it is searching; the response half
// stays inside ResponsePane, which owns its three documents and their editor hosts. Request scope
// searches the body editor — the params/headers tables already have their own filter box (P16
// D13's #toolbar-2 PanelSearchBox), which is a different and better affordance for rows than a
// match-stepping find is.
//
// Component-local, not tab state: a lens over what is on screen, the same rule the response pane's
// own find bar already follows (P16 D11).
const requestFindOpen = ref(false);
const requestBodyRef = ref<{
  findableDoc: string | null;
  findHost: FindBarHost | null;
} | null>(null);
const requestFindBarRef = ref<{
  query: string;
  currentGlobal: number;
  options: FindOptions;
} | null>(null);

function toggleRequestFind(): void {
  requestFindOpen.value = !requestFindOpen.value;
}
function closeRequestFind(): void {
  requestFindOpen.value = false;
}

/** Empty whenever the body pane is not showing a text editor (params/headers/urlencoded/form-data/
 *  binary), which is what makes the bar honestly report "0 of 0" there rather than searching a
 *  document that is not on screen. */
const requestFindTargets = computed<readonly FindBarTarget[]>(() => {
  if (!requestFindOpen.value) return [];
  const doc = requestBodyRef.value?.findableDoc;
  if (doc === null || doc === undefined) return [];
  return [{ doc, host: requestBodyRef.value?.findHost ?? null }];
});

/** Paints exactly the matches the bar counts and steps through. Read synchronously here (not
 *  inside the returned closure) so this computed's own identity changes when the query, the
 *  options or the current match does — which is what makes CodeMirrorHost repaint. */
const requestFindHighlights = computed<((doc: string) => readonly RangeHighlight[]) | undefined>(
  () => {
    if (!requestFindOpen.value) return undefined;
    const bar = requestFindBarRef.value;
    const query = bar?.query ?? '';
    if (!query) return undefined;
    const current = bar?.currentGlobal ?? -1;
    const options = bar?.options ?? DEFAULT_FIND_OPTIONS;
    return (doc: string) => findRanges(doc, query, current, options);
  },
);

function onUrlInput(value: string): void {
  patchHttpRequestTabState(props.tab.id, { url: value });
}

// P28 D12: pasting a curl command into the request bar builds the request from it, reusing P7's
// own parser (packages/api-core/src/http/curl/parse.ts) rather than adding a second one. Two
// escape hatches, both deliberate: text that does not look like a command pastes normally, and
// text that looks like one but that the parser rejects ALSO pastes normally — a paste is never
// silently swallowed.
function onUrlPaste(text: string, e: ClipboardEvent): void {
  if (!looksLikeCurlCommand(text)) return;
  if (!applyCurlToTab(props.tab.id, text)) return;
  e.preventDefault();
}

// P4 D15: dirtiness is a computation over two things already in memory — the tab's own state and
// the cached saved document — not a stored flag there would be something to set, clear, migrate or
// get wrong. `savedRequestFor` answers null for a tab bound to nothing, and for D14's orphan case
// (a row deleted in this window or another), which is what makes Save fall back to Save as…
const saved = computed(() => collectionsStore.savedRequestFor(props.tab.state.itemId));
const dirty = computed(() => isDirty(props.tab.state, saved.value));
const canSave = computed(() => props.tab.state.itemId !== null && saved.value !== null);

// P71 §3.2: an incognito tab has no route into a persisting editor — Save/Save as… no-op, and the
// #head-trailing button (below) is disabled with a tooltip naming why. This early return also
// covers registerCommand('api.save', onSave) and the command palette entry it registers.
function onSave(): void {
  if (incognito.value) return;
  const itemId = props.tab.state.itemId;
  if (!itemId || !saved.value) {
    onSaveAs();
    return;
  }
  void collectionsStore.saveRequest(
    itemId,
    props.tab.state.name || title.value,
    toSavedRequest(props.tab.state),
  );
}

function onSaveAs(): void {
  if (incognito.value) return;
  collectionsStore.openSaveDialog(
    props.tab.id,
    props.tab.state.name || title.value,
    toSavedRequest(props.tab.state),
  );
}

function onSend(): void {
  void httpRequestViewStore.send(props.tab.id);
}

// P7 D10: computes the frozen resolution exactly as send() does (resolveForExport — this file's
// own './state', P6 D7's short-circuit preserved) and hands the store a plain result; the dialog
// itself never reaches into views/** to get it. defaultContentType is P3 D7's own per-mode table,
// computed here rather than inside @kira/api-core's curl/ so that package keeps its no-app-import property.
async function onCopyAsCurl(): Promise<void> {
  const resolution = await resolveForExport(props.tab.id);
  if (!resolution) return;
  copyAsCurlStore.openCopyAsCurlDialog(
    resolution.method,
    resolution.resolved,
    resolution.deferredNames,
    defaultContentTypeFor(props.tab.state.bodyMode, props.tab.state.codeLanguage),
    collectionId.value,
    envId.value,
  );
}

// P9 D10: the raw editor has no text form for a formdata/file body (a file part is bytes on disk,
// not text) — disabled with a tooltip naming why, rather than generating an elided body the parser
// would take literally.
const canEditRaw = computed(() => canEditAsRaw(props.tab.state.bodyMode));
const editRawTooltip = computed(() =>
  canEditRaw.value
    ? 'Edit as raw HTTP…'
    : 'A form-data or binary body has no text form that can be edited and parsed back — a file part is bytes on disk, not text. Its wire form is in the response pane’s Raw view.',
);

// P9 D9: the buffer is generated pre-substitution, from the tab's own text — {{variables}} appear
// literally. defaultContentType mirrors onCopyAsCurl's own computation, over the *unresolved* tab
// state (never the live preview's resolved values — D9's whole point is that this is what the user
// typed, not what would be sent).
function onEditRaw(): void {
  if (!canEditRaw.value) return;
  const initialText = generateRawRequest(
    props.tab.state,
    defaultContentTypeFor(props.tab.state.bodyMode, props.tab.state.codeLanguage),
  );
  editRawStore.openEditRawDialog(
    props.tab.id,
    initialText,
    props.tab.state.bodyMode,
    props.tab.state.url,
  );
}

// P5 D6/D7/D17: the same resolution send() runs, over the tab's *current* state — a live preview
// of what would actually go out, without ever sending anything or reaching Go (a secret name is
// classified 'deferred' and never appears here, D5: its plaintext never enters the renderer to
// begin with). Only 'unknown' and an *uncatalogued* 'dynamic' reference are a warning — 'deferred'
// is correct and will resolve fine at send time, a catalogued 'dynamic' name will too (P6 D8), and
// 'resolved' needs no callout at all.
//
// P6 F2/D8: this computed calls resolveTabState with exactly three arguments, never four —
// generation must never be a side effect of typing (the chip re-runs on every keystroke). A
// catalogued $name is told apart from an unrecognised one by isDynamicName's Set lookup alone, so
// the preview stays a pure function of the tab's text: no await, no chunk load, nothing generated.
const collectionId = computed(() => collectionsStore.collectionIdFor(props.tab.state));
watch(
  [collectionId, envId],
  ([cid, eid]) => {
    void variableSetStore.ensureVariablesLoaded('collection', cid);
    void variableSetStore.ensureVariablesLoaded('environment', eid);
  },
  { immediate: true },
);
// P15b D4: one computed, over the same collectionId/envId this file already watches (immediately
// above) — rangeHighlights/hoverAt/candidates for the URL field, the request body editor, and (via
// FieldRowsTable's own props) the header/param/form-data value cells.
const variables = computed(() => variableSupport(collectionId.value, envId.value));

const unresolvedRefs = computed(() => {
  const { values, secretNames } = variableSetStore.mergedValuesAndSecrets(
    collectionId.value,
    envId.value,
  );
  const refs = resolveTabState(props.tab.state, values, secretNames).refs;
  const byName = new Map(
    refs
      // P28 D15(a): a catalogued dynamic reference is either spelling. substitute.ts's own
      // isDynamicReference classifies both `$name` and `fake.*` as 'dynamic', but this filter
      // only ever consulted isDynamicName ($-prefixed), so all 57 FAKE_NAMES were counted into the
      // "unresolved" chip as unknown dynamic values. They are generated at send time, not looked
      // up, and are never missing.
      .filter(
        (r) =>
          r.kind === 'unknown' ||
          (r.kind === 'dynamic' && !isDynamicName(r.name) && !isFakeName(r.name)),
      )
      .map((r) => [r.name, r]),
  );
  return [...byName.values()];
});
const unresolvedTooltip = computed(() =>
  unresolvedRefs.value
    .map((r) => (r.kind === 'dynamic' ? `${r.name} — unknown dynamic value` : r.name))
    .join(', '),
);

function onStop(): void {
  httpRequestViewStore.stop(props.tab.id);
}

const paramsCount = computed(() => parseQuery(splitUrl(props.tab.state.url).query).length);
const headersCount = computed(() => props.tab.state.headers.filter((h) => h.enabled).length);

// P90 §2.6: the Settings segment's own count badge — how many of the seven leaves this request
// overrides (non-null).
const settingsOverrideCount = computed(
  () => Object.values(props.tab.state.settings).filter((v) => v !== null).length,
);

// P90 §3.1: the Cookies segment's own count badge — populated by cookies.ts's shared runtime, kept
// fresh by the watcher below regardless of which pane is currently showing.
const requestCookiesCount = computed(
  () => cookiesStore.cookiesRuntime[props.tab.id]?.cookies.length ?? 0,
);

// D12: a count badge per segment — SegmentedControl has no dedicated count slot, so it is baked
// into the label text instead of widening that shared primitive for one caller.
const REQUEST_PANE_OPTIONS = computed(() => [
  {
    value: 'params' as const,
    label: paramsCount.value > 0 ? `Params (${paramsCount.value})` : 'Params',
    testid: 'http-request-pane-params',
  },
  {
    value: 'headers' as const,
    label: headersCount.value > 0 ? `Headers (${headersCount.value})` : 'Headers',
    testid: 'http-request-pane-headers',
  },
  {
    value: 'body' as const,
    label: bodyBadgeLabel(props.tab.state),
    testid: 'http-request-pane-body',
  },
  {
    value: 'settings' as const,
    label:
      settingsOverrideCount.value > 0 ? `Settings (${settingsOverrideCount.value})` : 'Settings',
    testid: 'http-request-pane-settings',
  },
  {
    value: 'cookies' as const,
    label: requestCookiesCount.value > 0 ? `Cookies (${requestCookiesCount.value})` : 'Cookies',
    testid: 'http-request-pane-cookies',
  },
]);

function setRequestPane(pane: HttpRequestPane): void {
  patchHttpRequestTabState(props.tab.id, { requestPane: pane });
}

// P16 D13: the request tables' own filter — Studio's own idiom (toolbar-search toggling a
// SearchToolbar row) applied here: an always-present filter row above a three-row headers table
// would be chrome for its own sake, so it's a toggle in #toolbar-2 instead. Shown only while the
// visible pane is actually a row table (Params, Headers, or Body in urlencoded/form-data mode) —
// the raw/code/binary/JSON body modes have nothing this filter could match. Component-local, not
// tab state: a lens, not a setting (§8 OQ-8's own rule for every filter this phase adds).
const fieldFilterOpen = ref(false);
const fieldFilterQuery = ref('');

// P17 D20/item 8: the unified overview panel's own open flag — component-local, same "a lens, not
// a setting" rule as fieldFilterOpen just above.
const overviewOpen = ref(false);
const overviewAnchorRef = ref<HTMLElement | null>(null);
// P90 §2.6: rewritten as an explicit allow-list — the two new panes (Settings, Cookies) have no
// rows to filter, and the old `!== 'body'` shorthand would otherwise leave the filter/descriptions
// toggles on screen over them.
const showFieldFilterToggle = computed(
  () =>
    props.tab.state.requestPane === 'params' ||
    props.tab.state.requestPane === 'headers' ||
    (props.tab.state.requestPane === 'body' &&
      (props.tab.state.bodyMode === 'urlencoded' || props.tab.state.bodyMode === 'formdata')),
);

// P90 §2.6: a warning chip beside the Send button while this request's *effective* sslVerify is
// false — MessageStrip.vue is too heavy for the toolbar, so this reuses the incognito chip's own
// inline shape above.
const effectiveSslVerify = computed(
  () => props.tab.state.settings.sslVerify ?? settingsStore.api.sslVerify,
);

// P90 §3.1: keeps cookiesRuntime fresh for this tab's current URL — on mount, on the URL changing
// (debounced), and after every send completes — but never while the effective cookie jar is off,
// since a jar-off request has nothing to fetch (§3.1's own rule).
const effectiveDisableCookieJar = computed(
  () => props.tab.state.settings.disableCookieJar ?? settingsStore.api.disableCookieJar,
);
watch(
  () => props.tab.state.url,
  (url) => {
    if (effectiveDisableCookieJar.value) return;
    cookiesStore.scheduleCookiesFetch(props.tab.id, url);
  },
  { immediate: true },
);
const unsubscribeSendCompleted = onSendCompleted((tabId) => {
  if (tabId !== props.tab.id || effectiveDisableCookieJar.value) return;
  cookiesStore.scheduleCookiesFetch(props.tab.id, props.tab.state.url);
});
onUnmounted(unsubscribeSendCompleted);
function toggleFieldFilter(): void {
  fieldFilterOpen.value = !fieldFilterOpen.value;
  // D13's own rule: closing the row must restore every hidden row.
  if (!fieldFilterOpen.value) fieldFilterQuery.value = '';
}

// P22b D7: unlike fieldFilterOpen above, this is persisted per tab (httpRequestTabStateShape's
// own fieldDescriptions) rather than a component-local lens — OQ-1's own resolution: a user who
// wants the description column always visible should not have to reopen it on every tab restore.
// One flag shared by every row table this tab renders (Params, Headers, and — through
// RequestBodyPane — urlencoded/form-data), matching the single toggle the row asks for.
function toggleFieldDescriptions(): void {
  patchHttpRequestTabState(props.tab.id, { fieldDescriptions: !props.tab.state.fieldDescriptions });
}

// D6: 0 means "the default half" — PanelSplitter itself needs a real pixel size.
const DEFAULT_REQUEST_PANE_HEIGHT = 260;
const requestPaneHeight = computed(
  () => props.tab.state.requestPaneHeight || DEFAULT_REQUEST_PANE_HEIGHT,
);
function onResizeRequestPane(size: number): void {
  patchHttpRequestTabState(props.tab.id, { requestPaneHeight: size });
}

// F15: view.run (⌘Return) and view.refresh (the refresh shortcut) both already route through
// this per-mounted-view registry with no menu/accelerator change (D13) — they both just trigger
// Send here, same as ConsoleView.vue registers Run/Run all onto the same two channels' shape.
let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  unregisterCommands = [
    registerCommand('view.run', onSend),
    registerCommand('view.refresh', onSend),
    // D15: the palette's own Save request entry, view-scoped exactly like the two above — a no-op
    // when no request tab is mounted, which is runCommand's documented behaviour.
    registerCommand('api.save', onSave),
    // P7 D10: same view-scoped shape as api.save above.
    registerCommand('api.copyAsCurl', onCopyAsCurl),
    // P9 D8: same view-scoped shape — a no-op with no request tab mounted, and here also a no-op
    // (not an error) for a formdata/file body, matching the toolbar button's own disabled state.
    registerCommand('api.editRaw', onEditRaw),
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <div class="http-request-view" data-testid="http-request-view">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <div class="p-view-head">
      <span
        v-if="railColor !== undefined"
        class="p-conn-dot"
        :class="{ none: !railColor || railColor === 'none' }"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span class="icon-box"><CodiconIcon name="globe" :size="13" /></span>
      <span class="p-view-target" data-testid="http-request-target">{{ title }}</span>
      <span class="p-chip p-method" :class="methodToken" data-testid="http-method-chip">{{ tab.state.method }}</span>
      <!-- D15: the dirty mark sits beside the name here and deliberately *not* on the tab strip,
           which renders purely from TAB_KINDS — a dirty(tab) registry member that seven of the
           eight kinds would answer false to is shared machinery for a cosmetic gain (§8 OQ-8). -->
      <Tooltip v-if="dirty">
        <TooltipTrigger as-child>
          <span class="dirty-mark" data-testid="http-dirty" aria-label="Unsaved changes">•</span>
        </TooltipTrigger>
        <TooltipContent>Unsaved changes</TooltipContent>
      </Tooltip>
      <Tooltip v-if="unresolvedRefs.length > 0">
        <TooltipTrigger as-child>
          <span class="p-chip warn" data-testid="http-unresolved-chip">{{ unresolvedRefs.length }} unresolved</span>
        </TooltipTrigger>
        <TooltipContent>{{ unresolvedTooltip }}</TooltipContent>
      </Tooltip>
      <!-- P71 §5.1: the view head's own incognito chip, beside the tab strip's icon. -->
      <Tooltip v-if="incognito">
        <TooltipTrigger as-child>
          <span class="p-chip" data-testid="http-incognito-chip">Incognito</span>
        </TooltipTrigger>
        <TooltipContent>Nothing from this tab is saved</TooltipContent>
      </Tooltip>
      <!-- P22b D3: Save stays ahead of the push, so it shifts position whenever the dirty mark or
           unresolved chip changes width — P15 D7 (OQ-2)'s own "first control ever placed in a view
           head" comment still holds, only the slot moved. -->
      <span class="p-push flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
              <Button
                variant="toolbar"
                size="kira"
                data-testid="http-save"
                :disabled="incognito || (canSave && !dirty)"
                @click="onSave"
              >
                <CodiconIcon name="save" :size="13" />
                Save
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ incognito ? 'Saving is off in an incognito tab' : (canSave ? 'Save request' : 'Save request to a collection') }}</TooltipContent>
        </Tooltip>
      </span>
    </div>
    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar">
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira-icon" aria-label="Refresh" data-testid="http-request-refresh" @click="onSend">
              <CodiconIcon name="refresh" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
              <Button variant="toolbar" size="kira-icon" :class="{ 'is-live': running }" :disabled="!running" aria-label="Stop" data-testid="http-request-stop" @click="onStop">
                <CodiconIcon name="debug-stop" :size="13" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </div>
      <MethodSelect
        :model-value="tab.state.method"
        testid="http-method-select"
        @update:model-value="onMethodChange"
      />
      <div class="url-field">
        <AutocompleteField
          :model-value="tab.state.url"
          placeholder="https://api.example.com/users"
          data-testid="http-url"
          :candidates="variables.candidates"
          :token-at="templateToken"
          :range-highlights="variables.rangeHighlights"
          :hover-at="variables.hoverAt"
          @update:model-value="onUrlInput"
          @paste-text="onUrlPaste"
          @enter="onSend"
        />
      </div>
      <!-- P90 §2.6: same inline chip shape the incognito chip above (view-head) uses. -->
      <Tooltip v-if="!effectiveSslVerify">
        <TooltipTrigger as-child>
          <span class="p-chip warn" data-testid="http-ssl-verify-off-chip">
            <CodiconIcon name="unverified" />
          </span>
        </TooltipTrigger>
        <TooltipContent>Certificate verification is off for this request</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
            <Button
              variant="toolbar-primary"
              size="kira"
              data-testid="http-send"
              :disabled="running"
              @click="onSend"
            >
              <CodiconIcon name="play" :size="13" />
              Send
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Send</TooltipContent>
      </Tooltip>
      <span class="p-push" />
      <!-- P22 D4: RunState stays ahead of the toolbar-end group so a consumer's own last control
           really is the toolbar's right-most element. LAW 12: the label reserves its own
           min-width, so it reflows neither the push to its left nor the group to its right. -->
      <span
        class="p-run-state inline-flex items-center gap-1 font-[family-name:var(--kira-font-data)] text-kira-xs text-subtle"
        :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
      >
        <span class="label min-w-[7ch] text-right">{{ runStateLabel }}</span>
        <span
          class="ring h-[11px] w-[11px] shrink-0 rounded-full border-[1.5px] border-border-strong"
          :class="{
            'animate-[spin_0.7s_linear_infinite] border-t-primary border-r-transparent border-b-primary border-l-primary': runState.status === 'running',
            'border-error': runState.status === 'error',
          }"
        />
      </span>
      <!-- P71 §5.2: rows before Copy as curl/Edit as raw are exports of the tab's *current*
           text, unaffected by incognito — this toggle sits after them. Tooltip states the
           prospective rule (§3.1): switching this on stops future writes, it never deletes rows
           already saved before it was flipped. -->
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira-icon" aria-label="Copy as curl" data-testid="http-copy-as-curl" @click="onCopyAsCurl">
              <CodiconIcon name="terminal" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy as curl…</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
              <Button variant="toolbar" size="kira-icon" :disabled="!canEditRaw" aria-label="Edit as raw HTTP" data-testid="http-edit-raw" @click="onEditRaw">
                <CodiconIcon name="code" :size="13" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ editRawTooltip }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-input text-fg': incognito }"
              aria-label="Incognito"
              data-testid="http-incognito-toggle"
              @click="toggleIncognito"
            >
              <CodiconIcon name="eye-closed" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ incognito ? 'Incognito — turn off to resume saving this tab' : 'Incognito — nothing from this tab is saved from here on' }}</TooltipContent>
        </Tooltip>
      </div>
    </div>

    <div class="p-toolbar last">
      <ToggleGroup
        type="single"
        :model-value="tab.state.requestPane"
        data-testid="http-request-pane-toggle"
        @update:model-value="(v) => v && setRequestPane(v as HttpRequestPane)"
      >
        <ToggleGroupItem v-for="opt in REQUEST_PANE_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <Tooltip v-if="showFieldFilterToggle">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': fieldFilterOpen }"
            aria-label="Filter"
            data-testid="http-field-filter-toggle"
            @click="toggleFieldFilter"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      <Tooltip v-if="showFieldFilterToggle">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': tab.state.fieldDescriptions }"
            aria-label="Descriptions"
            data-testid="http-field-descriptions-toggle"
            @click="toggleFieldDescriptions"
          >
            <CodiconIcon name="note" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tab.state.fieldDescriptions ? 'Hide descriptions' : 'Show descriptions' }}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': requestFindOpen }"
            aria-label="Find in request"
            data-testid="http-request-find-toggle"
            @click="toggleRequestFind"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Find in the request body</TooltipContent>
      </Tooltip>
      <Popover :open="overviewOpen" @update:open="overviewOpen = $event">
        <div ref="overviewAnchorRef" class="overview-anchor">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                :class="{ 'bg-input text-fg': overviewOpen }"
                aria-label="Variables"
                data-testid="http-variables-overview-toggle"
                @click="overviewOpen = !overviewOpen"
              >
                <CodiconIcon name="variable-group" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Variables</TooltipContent>
          </Tooltip>
          <PopoverAnchor :reference="overviewAnchorRef ?? undefined" />
        </div>
        <VariablesOverviewPanel
          v-if="overviewOpen"
          :collection-id="collectionId"
          :environment-id="envId"
          :can-edit="!incognito"
          @close="overviewOpen = false"
        />
      </Popover>
      <EnvironmentSelect :tab-id="tab.id" />
    </div>

    <!-- P28 D11: above the request panel it searches, not floating over it — LAW 03, the same
         placement rule the response pane's own bar and the data views' SearchToolbar follow. -->
    <ResponseFindBar
      v-if="requestFindOpen"
      ref="requestFindBarRef"
      :targets="requestFindTargets"
      @close="closeRequestFind"
    />

    <SplitterGroup direction="vertical" class="request-response-split">
      <SplitterPanel
        class="request-pane"
        data-testid="http-request-pane"
        size-unit="px"
        :default-size="requestPaneHeight"
        :min-size="120"
        :max-size="800"
        :order="1"
        @resize="onResizeRequestPane"
      >
        <InputGroup v-if="fieldFilterOpen && showFieldFilterToggle">
          <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
          <InputGroupInput v-model="fieldFilterQuery" placeholder="Filter" data-testid="http-field-filter" />
          <InputGroupAddon v-if="fieldFilterQuery" align="inline-end">
            <InputGroupButton aria-label="Clear filter" @click="fieldFilterQuery = ''">
              <CodiconIcon name="close" :size="13" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <QueryParamsTable
          v-if="tab.state.requestPane === 'params'"
          :tab="tab"
          :variables="variables"
          :filter-query="fieldFilterQuery"
          :show-descriptions="tab.state.fieldDescriptions"
        />
        <RequestHeadersTable
          v-else-if="tab.state.requestPane === 'headers'"
          :tab="tab"
          :variables="variables"
          :filter-query="fieldFilterQuery"
          :show-descriptions="tab.state.fieldDescriptions"
        />
        <RequestSettingsPane v-else-if="tab.state.requestPane === 'settings'" :tab="tab" />
        <CookiesPane
          v-else-if="tab.state.requestPane === 'cookies'"
          mode="request"
          :tab-id="tab.id"
          :url="tab.state.url"
          :disable-cookie-jar="effectiveDisableCookieJar"
        />
        <RequestBodyPane
          v-else
          ref="requestBodyRef"
          :tab="tab"
          :variables="variables"
          :find-highlights="requestFindHighlights"
          :filter-query="fieldFilterQuery"
          :show-descriptions="tab.state.fieldDescriptions"
        />
      </SplitterPanel>

      <SplitterResizeHandle class="request-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />

      <SplitterPanel class="response-pane-slot" data-testid="http-response-pane-slot" :order="2">
        <ResponsePane :tab="tab" />
      </SplitterPanel>
    </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.overview-anchor {
  @apply relative flex;
}

.http-request-view {
  @apply flex h-full min-h-0 flex-col;
}

/* P15 D4: TextField's inheritAttrs: false lands a call site's own class/style on the inner
   <input>, never the wrapping .p-input box that actually sizes it (F3) — the app's existing
   wrapper + :deep(.p-input) idiom, used at ten other call sites, fixes it here too. Was
   `style="flex: 1"` directly on <TextField>, which landed on the input (already flex: 1) and did
   nothing — the URL field never grew with the window. api-ui-consistency.spec.ts selects
   `.url-field` directly — kept as a marker class. */
.url-field {
  @apply min-w-0 flex-1;
}
.url-field :deep(.p-input) {
  @apply w-full;
}

.request-response-split {
  @apply flex flex-1 min-h-0 flex-col;
}

/* api-ui-consistency.spec.ts selects `.request-pane` directly — kept as a marker class. */
.request-pane {
  @apply flex min-h-0 flex-col overflow-hidden;
}

/* P104 §3.3: reka's SplitterResizeHandle carries no divider styling of its own — this reproduces
   PanelSplitter.vue's old `divider` prop line exactly (a centred inset box-shadow, cleared on
   hover/drag, --kira-focus fill taking over instead). Mirrors views/shared/celleditor/
   CellEditorDock.vue's own .cell-splitter comment: the workbench grid gives a splitter its size
   from a gap row; inside a view there is no gap band, so the track carries its own explicit
   height. P22 D13 (F22): the request/response boundary used to be 4px of nothing until the
   pointer crossed it. http-request.spec.ts/grpc-request.spec.ts poll `.request-splitter`'s
   box-shadow — kept as a marker class. */
.request-splitter {
  @apply shrink-0 h-1 cursor-row-resize bg-transparent hover:bg-focus data-[state='drag']:bg-focus;
  box-shadow: inset 0 calc(var(--kira-border-width) * -1) 0 0 var(--kira-border);
}
.request-splitter:hover,
.request-splitter[data-state='drag'] {
  box-shadow: none;
}

.dirty-mark {
  @apply text-warn leading-none text-kira-lg;
}

/* SplitterPanel's own inline style now owns flex-grow/basis (it always wins over a class rule) —
   min-h-0 is the only thing this class still needs to contribute. */
.response-pane-slot {
  @apply min-h-0;
}
</style>
