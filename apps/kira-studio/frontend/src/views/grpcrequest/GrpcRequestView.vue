<script setup lang="ts">
import { isDynamicName, isFakeName, isGrpcDirty, toSavedGrpcRequest } from '@kira/api-core';
import { grpcRequestTitle } from '@shared/domain/grpc';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@theme/components/ui/input-group';
import { Popover, PopoverAnchor } from '@theme/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { useDebounceFn } from '@vueuse/core';
import { registerCommand } from '@workbench/shortcuts/commands';
import { SplitterGroup, SplitterPanel, SplitterResizeHandle } from 'reka-ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import EnvironmentSelect from '../../api/EnvironmentSelect.vue';
import { useVariableRows } from '../../api/state/apiQueries';
import { useCollectionsStore } from '../../api/state/collections';
import { useSaveRequestDialogStore } from '../../api/state/saveRequestDialog';
import {
  variableCompletionSource,
  variableHoverSource,
  variableSupport,
} from '../../api/state/variableCompletion';
import { mergeVariableRows } from '../../api/state/variables';
import { patchGrpcRequestTabState } from '../../api/tabs';
import VariablesOverviewPanel from '../../api/VariablesOverviewPanel.vue';
import { beautifyJson } from '../../beautify';
import MonacoHost from '../../editor/MonacoHost.vue';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import { templateToken } from '../../theme/completion';
import AutocompleteField from '../shared/AutocompleteField.vue';
import { useRequestChrome } from '../shared/request/useRequestChrome';
import { useRequestTabSave } from '../shared/request/useRequestTabSave';
import GrpcMetadataTable from './GrpcMetadataTable.vue';
import ResponsePane from './ResponsePane.vue';
import SchemaBrowser from './SchemaBrowser.vue';
import { findMethod, resolveGrpcTabState, useGrpcRequestViewStore } from './state';

// MainView.vue keys this component by tab.id — same discipline as every other *View.vue.
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

const collectionsStore = useCollectionsStore();
const saveRequestDialogStore = useSaveRequestDialogStore();
const grpcRequestViewStore = useGrpcRequestViewStore();

const rt = computed(() => grpcRequestViewStore.runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');
const title = computed(() => grpcRequestTitle(props.tab.state));

// P108 F14: state.ts's own call() reads `method?.serverStreaming ?? false` from findMethod against
// whatever schema happens to be in schemaRuntime at that instant — a Call issued before the schema
// (re)load in flight resolves finds no method at all and silently defaults to unary, so a genuinely
// server-streaming method got called as one-shot instead. Rather than have call() await a load
// (a user-visible delay on every single Call, not just the rare early one), Call disables until
// findMethod can actually resolve the tab's own service+method against the current schema.
const methodResolved = computed(() => {
  const schema = grpcRequestViewStore.schemaRuntime[props.tab.id]?.schema ?? null;
  return !!findMethod(schema, props.tab.state.service, props.tab.state.method);
});

// P71 §5/§3.1: HttpRequestView.vue's own pair — this view's incognito state and the per-tab
// environment id it reads through while incognito.
const { railColor, runState, runStateLabel, incognito, toggleIncognito, envId } = useRequestChrome(
  () => props.tab,
);

const TLS_OPTIONS = [
  { value: 'tls' as const, label: 'TLS', testid: 'grpc-tls-tls' },
  { value: 'plaintext' as const, label: 'Plaintext', testid: 'grpc-tls-plaintext' },
];
function setTlsMode(mode: 'plaintext' | 'tls'): void {
  patchGrpcRequestTabState(props.tab.id, { tlsMode: mode });
}

function onTargetInput(value: string): void {
  patchGrpcRequestTabState(props.tab.id, { target: value });
}

// D13: the toolbar's own method picker — a plain <select> over the resolved schema, showing
// "Service/Method" with a streaming badge folded into the option label (F23: no new primitive
// needed for a value list this shape). The full browsable list with per-service grouping lives in
// the Schema pane (SchemaBrowser.vue) — this is the fast path once a schema is already loaded.
const methodOptions = computed(() => {
  const schema = grpcRequestViewStore.schemaRuntime[props.tab.id]?.schema;
  if (!schema) return [];
  const out: { value: string; label: string }[] = [];
  for (const svc of schema.services) {
    for (const m of svc.methods) {
      const badge = m.serverStreaming || m.clientStreaming ? ' (stream)' : '';
      out.push({ value: `${svc.name}|${m.name}`, label: `${svc.name}/${m.name}${badge}` });
    }
  }
  return out;
});
const selectedMethodValue = computed(() => `${props.tab.state.service}|${props.tab.state.method}`);
function onMethodSelect(e: Event): void {
  const value = (e.target as HTMLSelectElement).value;
  const [service, method] = value.split('|');
  const schema = grpcRequestViewStore.schemaRuntime[props.tab.id]?.schema ?? null;
  const m = findMethod(schema, service, method);
  patchGrpcRequestTabState(props.tab.id, {
    service,
    method,
    message: m?.requestTemplate ?? props.tab.state.message,
  });
}

// D4: the schema is fetched once a reflection target (or a .proto path) exists — mirrors
// views/httprequest/HttpRequestView.vue's own ensureVariablesLoaded watch shape.
//
// Finding 13: debounced the same 150ms this app already uses for a fast typist
// (project/state/tree.ts's own SEARCH_DEBOUNCE_MS) — without it, every keystroke of a live
// target/protoPath fired its own Describe round trip, most of them against a partial, not-yet-
// finished string. loadSchema's own generation-id guard (state.ts) is still what makes a stale
// response harmless if one lands late regardless.
const SCHEMA_LOAD_DEBOUNCE_MS = 150;
const loadSchemaDebounced = useDebounceFn(() => {
  void grpcRequestViewStore.loadSchema(props.tab.id);
}, SCHEMA_LOAD_DEBOUNCE_MS);
watch(
  () =>
    [props.tab.state.descriptorMode, props.tab.state.target, props.tab.state.protoPath] as const,
  ([mode, target, protoPath]) => {
    loadSchemaDebounced.cancel();
    if (mode === 'reflection' && !target) return;
    if (mode === 'proto' && !protoPath) return;
    void loadSchemaDebounced();
  },
  { immediate: true },
);

const saved = computed(() => collectionsStore.savedGrpcRequestFor(props.tab.state.itemId));
const dirty = computed(() => isGrpcDirty(props.tab.state, saved.value));
const canSave = computed(() => props.tab.state.itemId !== null && saved.value !== null);

// P108 F4: HttpRequestView.vue's own fix, mirrored — see its comment for the full rationale. A
// restored tab's itemId never got its saved side fetched, leaving `saved` null forever, the same
// shape as D14's genuine orphan. `unresolved` stays true only until that fetch settles.
const unresolved = computed(() => {
  const itemId = props.tab.state.itemId;
  return itemId !== null && saved.value === null && !collectionsStore.isOrphanGrpcRequest(itemId);
});
watch(
  () => props.tab.state.itemId,
  (itemId) => {
    if (itemId) void collectionsStore.ensureSavedGrpcRequestLoaded(itemId);
  },
  { immediate: true },
);

// P71 §3.2/P107 T1-16: HttpRequestView.vue's own pair — see views/shared/request/useRequestTabSave.ts.
// onSaveAs is only ever reached from onSave's own no-saved-row fallback — no separate UI trigger
// in this view, so it isn't destructured here.
const { onSave } = useRequestTabSave({
  tabId: () => props.tab.id,
  incognito: () => incognito.value,
  itemId: () => props.tab.state.itemId,
  saved: () => saved.value,
  unresolved: () => unresolved.value,
  name: () => props.tab.state.name || title.value,
  toSaved: () => toSavedGrpcRequest(props.tab.state),
  save: (itemId, name, body) => collectionsStore.saveGrpcRequest(itemId, name, body),
  openSaveDialog: (tabId, name, body) =>
    saveRequestDialogStore.openSaveGrpcDialog(tabId, name, body),
});

function onCall(): void {
  void grpcRequestViewStore.call(props.tab.id);
}

function onStop(): void {
  grpcRequestViewStore.stop(props.tab.id);
}

const collectionId = computed(() => collectionsStore.collectionIdFor(props.tab.state));
// P112: useVariableRows observes each scope's query directly — no explicit ensureVariablesLoaded
// call; TanStack fetches on first observer and refetches on a kira:api:dataChanged invalidation.
const colRows = useVariableRows('collection', collectionId);
const envRows = useVariableRows('environment', envId);
// P18 D10: HttpRequestView.vue's own one-line computed, over the colRows/envRows this view now
// observes directly — rangeHighlights/hoverAt/candidates for the target field, the metadata value
// cells, and (rangeHighlights only) the message editor.
const variables = computed(() =>
  variableSupport(colRows.data.value ?? [], envRows.data.value ?? []),
);

const unresolvedRefs = computed(() => {
  const { values, secretNames } = mergeVariableRows(
    colRows.data.value ?? [],
    envRows.data.value ?? [],
  );
  const refs = resolveGrpcTabState(props.tab.state, values, secretNames).refs;
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

const REQUEST_PANE_OPTIONS = [
  { value: 'message' as const, label: 'Message', testid: 'grpc-request-pane-message' },
  { value: 'metadata' as const, label: 'Metadata', testid: 'grpc-request-pane-metadata' },
  { value: 'schema' as const, label: 'Schema', testid: 'grpc-request-pane-schema' },
];
function setRequestPane(pane: 'message' | 'metadata' | 'schema'): void {
  patchGrpcRequestTabState(props.tab.id, { requestPane: pane });
}

// P16 D13: the metadata table's own filter — same toggle-in-#toolbar-2 idiom as
// HttpRequestView.vue's request tables (Studio's own toolbar-search precedent). Only relevant on
// the Metadata pane. Component-local, not tab state — a lens, not a setting.
const fieldFilterOpen = ref(false);
const fieldFilterQuery = ref('');
function toggleFieldFilter(): void {
  fieldFilterOpen.value = !fieldFilterOpen.value;
  if (!fieldFilterOpen.value) fieldFilterQuery.value = '';
}

// P22b D7: HttpRequestView.vue's own persisted description-column toggle, mirrored here —
// fieldDescriptions is a tab-state field (unlike fieldFilterOpen above), so it survives a tab
// restore (OQ-1).
function toggleFieldDescriptions(): void {
  patchGrpcRequestTabState(props.tab.id, {
    fieldDescriptions: !props.tab.state.fieldDescriptions,
  });
}

// P17 D20/item 8: same component-local flag as HttpRequestView.vue's own.
const overviewOpen = ref(false);
const overviewAnchorRef = ref<HTMLElement | null>(null);

function onMessageInput(value: string): void {
  patchGrpcRequestTabState(props.tab.id, { message: value });
}

const DEFAULT_REQUEST_PANE_HEIGHT = 260;
const requestPaneHeight = computed(
  () => props.tab.state.requestPaneHeight || DEFAULT_REQUEST_PANE_HEIGHT,
);
function onResizeRequestPane(size: number): void {
  patchGrpcRequestTabState(props.tab.id, { requestPaneHeight: size });
}

function onBeautify(): void {
  const { text, ok } = beautifyJson(props.tab.state.message, 'indented');
  if (ok) patchGrpcRequestTabState(props.tab.id, { message: text });
}

let unregisterCommands: Array<() => void> = [];
onMounted(() => {
  // P108 F5, subsumed by P112: HttpRequestView.vue's own fix, mirrored — see its comment.
  unregisterCommands = [
    registerCommand('view.run', onCall),
    registerCommand('view.refresh', onCall),
    registerCommand('view.format', onBeautify),
    registerCommand('api.save', onSave),
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
  loadSchemaDebounced.cancel();
});
</script>

<template>
  <div class="grpc-request-view" data-testid="grpc-request-view">
    <!-- P104 §3: ViewChrome/ViewHeader/RunState inlined (no library counterpart). -->
    <div class="p-view-head">
      <span
        v-if="railColor !== undefined"
        class="p-conn-dot"
        :class="{ none: !railColor || railColor === 'none' }"
        :style="{ '--kira-rail': connColorVar(railColor) }"
      />
      <span class="icon-box"><CodiconIcon name="symbol-interface" :size="13" /></span>
      <span class="p-view-target" data-testid="grpc-request-target">{{ title }}</span>
      <span v-if="tab.state.service && tab.state.method" class="p-chip info" data-testid="grpc-method-chip">
        {{ tab.state.service }}/{{ tab.state.method }}
      </span>
      <Tooltip v-if="dirty">
        <TooltipTrigger as-child>
          <span class="dirty-mark" role="img" data-testid="grpc-dirty" aria-label="Unsaved changes">•</span>
        </TooltipTrigger>
        <TooltipContent>Unsaved changes</TooltipContent>
      </Tooltip>
      <Tooltip v-if="unresolvedRefs.length > 0">
        <TooltipTrigger as-child>
          <span class="p-chip warn" data-testid="grpc-unresolved-chip">{{ unresolvedRefs.length }} unresolved</span>
        </TooltipTrigger>
        <TooltipContent>{{ unresolvedTooltip }}</TooltipContent>
      </Tooltip>
      <!-- P71 §5.1: HttpRequestView.vue's own view-head chip. -->
      <Tooltip v-if="incognito">
        <TooltipTrigger as-child>
          <span class="p-chip" data-testid="grpc-incognito-chip">Incognito</span>
        </TooltipTrigger>
        <TooltipContent>Nothing from this tab is saved</TooltipContent>
      </Tooltip>
      <span class="p-push flex items-center gap-1">
        <!-- P22b D3 (HttpRequestView.vue's own sibling): Save stays ahead of the push, same as the
             #badges group above, so it shifts position with the dirty mark/unresolved chip. -->
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button
                variant="toolbar"
                size="kira"
                data-testid="grpc-save"
                :disabled="incognito || unresolved || (canSave && !dirty)"
                @click="onSave"
              >
                <CodiconIcon name="save" :size="13" />
                Save
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>{{ incognito ? 'Saving is off in an incognito tab' : unresolved ? 'Checking whether this request is still saved…' : (canSave ? 'Save request' : 'Save request to a collection') }}</TooltipContent>
        </Tooltip>
      </span>
    </div>
    <div class="p-toolbar-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />
    <div class="p-toolbar">
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira-icon" aria-label="Refresh" data-testid="grpc-request-refresh" @click="onCall">
              <CodiconIcon name="refresh" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <TooltipDisabledTrigger>
              <Button variant="toolbar" size="kira-icon" :class="{ 'is-live': running }" :disabled="!running" aria-label="Stop" data-testid="grpc-request-stop" @click="onStop">
                <CodiconIcon name="debug-stop" :size="13" />
              </Button>
            </TooltipDisabledTrigger>
          </TooltipTrigger>
          <TooltipContent>Stop</TooltipContent>
        </Tooltip>
      </div>
      <!-- P18 D14 (P15 D4's gRPC sibling): style="flex: 1" directly on AutocompleteField was a
           no-op (F14) -- TextField/AutocompleteField set inheritAttrs: false, so a call-site
           style lands on the inner <input> (already flex: 1) and never on the wrapping .p-input
           box that actually sizes it. The app's existing wrapper + :deep(.p-input) idiom (used
           at ten other call sites, HttpRequestView.vue's own .url-field among them) fixes it
           here too — the target field now actually grows with the window. -->
      <div class="grpc-target-field">
        <AutocompleteField
          :model-value="tab.state.target"
          placeholder="api.example.com:443"
          data-testid="grpc-target"
          :candidates="variables.candidates"
          :token-at="templateToken"
          :range-highlights="variables.rangeHighlights"
          :hover-at="variables.hoverAt"
          @update:model-value="onTargetInput"
          @enter="onCall"
        />
      </div>
      <ToggleGroup type="single" :model-value="tab.state.tlsMode" data-testid="grpc-tls-toggle" @update:model-value="(v) => v && setTlsMode(v as 'plaintext' | 'tls')">
        <ToggleGroupItem v-for="opt in TLS_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">{{ opt.label }}</ToggleGroupItem>
      </ToggleGroup>
      <!-- P22b D10: the same wrapper + :deep(.p-select) idiom .grpc-target-field uses above, for
           the identical reason — a bare <select> has no width rule of its own, so it shrinks to
           its widest <option> label. Both fields are flex: 1 in this one toolbar row, so they
           share the free space evenly and stay responsive at either extreme of window size. -->
      <div class="grpc-method-field">
        <select
          class="p-select bordered"
          data-testid="grpc-method-select"
          :value="selectedMethodValue"
          :disabled="methodOptions.length === 0"
          @change="onMethodSelect"
        >
          <option value="" disabled>Choose a method…</option>
          <option v-for="opt in methodOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger>
            <Button
              variant="toolbar-primary"
              size="kira"
              data-testid="grpc-call"
              :disabled="running || !tab.state.service || !tab.state.method || !methodResolved"
              @click="onCall"
            >
              <CodiconIcon name="play" :size="13" />
              Call
            </Button>
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>{{ !running && tab.state.service && tab.state.method && !methodResolved ? 'Waiting on the schema…' : 'Call' }}</TooltipContent>
      </Tooltip>
      <span class="p-push" />
      <span
        class="p-run-state inline-flex items-center gap-1 font-[family-name:var(--kira-font-data)] text-kira-xs text-subtle"
        :class="{ 'text-info': runState.status === 'running', 'text-error': runState.status === 'error' }"
      >
        <span class="label min-w-[7ch] text-right">{{ runStateLabel }}</span>
        <span
          class="ring h-3 w-3 shrink-0 rounded-full border-2 border-border-strong"
          :class="{
            'animate-kira-spin border-t-primary border-r-transparent border-b-primary border-l-primary': runState.status === 'running',
            'border-error': runState.status === 'error',
          }"
        />
      </span>
      <!-- P71 §5.2: HttpRequestView.vue's own toolbar toggle — gRPC's #toolbar row has no other
           icon-only action group, so this is its own toolbar-end group. -->
      <div class="group">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              :class="{ 'bg-input text-fg': incognito }"
              aria-label="Incognito"
              data-testid="grpc-incognito-toggle"
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
      <ToggleGroup type="single" :model-value="tab.state.requestPane" data-testid="grpc-request-pane-toggle" @update:model-value="(v) => v && setRequestPane(v as 'message' | 'metadata' | 'schema')">
        <ToggleGroupItem v-for="opt in REQUEST_PANE_OPTIONS" :key="opt.value" :value="opt.value" :data-testid="opt.testid">{{ opt.label }}</ToggleGroupItem>
      </ToggleGroup>
      <Tooltip v-if="tab.state.requestPane === 'message'">
        <TooltipTrigger as-child>
          <Button variant="toolbar" size="kira-icon" aria-label="Beautify" data-testid="grpc-beautify" @click="onBeautify">
            <CodiconIcon name="expand-all" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Beautify</TooltipContent>
      </Tooltip>
      <Tooltip v-if="tab.state.requestPane === 'metadata'">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': fieldFilterOpen }"
            aria-label="Filter"
            data-testid="grpc-field-filter-toggle"
            @click="toggleFieldFilter"
          >
            <CodiconIcon name="search" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Filter</TooltipContent>
      </Tooltip>
      <Tooltip v-if="tab.state.requestPane === 'metadata'">
        <TooltipTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            :class="{ 'bg-input text-fg': tab.state.fieldDescriptions }"
            aria-label="Descriptions"
            data-testid="grpc-field-descriptions-toggle"
            @click="toggleFieldDescriptions"
          >
            <CodiconIcon name="note" :size="13" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ tab.state.fieldDescriptions ? 'Hide descriptions' : 'Show descriptions' }}</TooltipContent>
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
                data-testid="grpc-variables-overview-toggle"
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

    <SplitterGroup direction="vertical" class="request-response-split">
      <SplitterPanel
        class="request-pane"
        data-testid="grpc-request-pane"
        size-unit="px"
        :default-size="requestPaneHeight"
        :min-size="120"
        :max-size="800"
        :order="1"
        @resize="onResizeRequestPane"
      >
        <MonacoHost
          v-if="tab.state.requestPane === 'message'"
          :doc="tab.state.message"
          language="json"
          :read-only="false"
          :range-highlights="variables.rangeHighlights"
          :hover-source="variableHoverSource(variables.hoverInfo)"
          autocomplete
          :completion-sources="[variableCompletionSource(variables.candidates)]"
          auto-close-brackets
          data-testid="grpc-message-editor"
          @update:doc="onMessageInput"
        />
        <template v-else-if="tab.state.requestPane === 'metadata'">
          <InputGroup v-if="fieldFilterOpen">
            <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
            <InputGroupInput v-model="fieldFilterQuery" placeholder="Filter" data-testid="grpc-field-filter" />
            <InputGroupAddon v-if="fieldFilterQuery" align="inline-end">
              <InputGroupButton aria-label="Clear filter" @click="fieldFilterQuery = ''">
                <CodiconIcon name="close" :size="13" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
          <GrpcMetadataTable
            :tab="tab"
            :filter-query="fieldFilterQuery"
            :variables="variables"
            :show-descriptions="tab.state.fieldDescriptions"
          />
        </template>
        <SchemaBrowser v-else :tab="tab" />
      </SplitterPanel>

      <SplitterResizeHandle class="request-splitter" :hit-area-margins="{ coarse: 8, fine: 4 }" />

      <SplitterPanel class="response-pane-slot" data-testid="grpc-response-pane-slot" :order="2">
        <ResponsePane :tab="tab" />
      </SplitterPanel>
    </SplitterGroup>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P18 D14/F14: HttpRequestView.vue's own .url-field idiom, verbatim — the wrapper (not the inner
   input) is what actually sizes in the toolbar row. api-ui-consistency.spec.ts selects
   `.grpc-target-field` directly — kept as a marker class. */
.grpc-target-field {
  @apply min-w-0 flex-1;
}
.grpc-target-field :deep(.p-input) {
  @apply w-full;
}

/* P22b D10: the method select's own sibling of .grpc-target-field above — a bare <select> has no
   width rule of its own and shrinks to its widest <option>. No :deep() needed here (unlike the
   target field above): the <select> is a plain element in this component's own template, not
   behind a child component's scoping boundary. */
.grpc-method-field {
  @apply min-w-0 flex-1;
}
.grpc-method-field .p-select {
  @apply w-full;
}

.overview-anchor {
  @apply relative flex;
}

.grpc-request-view {
  @apply flex h-full min-h-0 flex-col;
}

.request-response-split {
  @apply flex flex-1 min-h-0 flex-col;
}

.request-pane {
  @apply flex min-h-0 flex-col overflow-hidden;
}

/* P104 §3.3: HttpRequestView.vue's own twin comment — reka's SplitterResizeHandle carries no
   divider styling of its own, reproduced here exactly. P22 D13 (F22): the request/response
   boundary used to be 4px of nothing until the pointer crossed it. grpc-request.spec.ts polls
   `.request-splitter`'s box-shadow — kept as a marker class. */
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
