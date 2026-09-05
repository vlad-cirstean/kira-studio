<script setup lang="ts">
import { isDynamicName, isGrpcDirty, toSavedGrpcRequest } from '@kira/api-core';
import { grpcRequestTitle } from '@shared/domain/grpc';
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import EnvironmentSelect from '../../api/EnvironmentSelect.vue';
import {
  collectionIdFor,
  openSaveGrpcDialog,
  savedGrpcRequestFor,
  saveGrpcRequest,
} from '../../api/state/collections';
import {
  activeEnvironmentId,
  ensureVariablesLoaded,
  mergedValuesAndSecrets,
} from '../../api/state/variables';
import { patchGrpcRequestTabState } from '../../api/tabs';
import { beautifyJson } from '../../beautify';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { registerCommand } from '../../shortcuts/commands';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PanelSearchBox from '../../theme/primitives/PanelSearchBox.vue';
import PanelSplitter from '../../theme/primitives/PanelSplitter.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import MetadataTable from './MetadataTable.vue';
import ResponsePane from './ResponsePane.vue';
import SchemaBrowser from './SchemaBrowser.vue';
import {
  call,
  findMethod,
  loadSchema,
  resolveGrpcTabState,
  runtime,
  schemaRuntime,
  stop,
} from './state';

// MainView.vue keys this component by tab.id — same discipline as every other *View.vue.
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');
const title = computed(() => grpcRequestTitle(props.tab.state));

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
  const schema = schemaRuntime[props.tab.id]?.schema;
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
  const schema = schemaRuntime[props.tab.id]?.schema ?? null;
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
let schemaLoadTimer: ReturnType<typeof setTimeout> | undefined;
watch(
  () =>
    [props.tab.state.descriptorMode, props.tab.state.target, props.tab.state.protoPath] as const,
  ([mode, target, protoPath]) => {
    clearTimeout(schemaLoadTimer);
    if (mode === 'reflection' && !target) return;
    if (mode === 'proto' && !protoPath) return;
    schemaLoadTimer = setTimeout(() => {
      void loadSchema(props.tab.id);
    }, SCHEMA_LOAD_DEBOUNCE_MS);
  },
  { immediate: true },
);

const saved = computed(() => savedGrpcRequestFor(props.tab.state.itemId));
const dirty = computed(() => isGrpcDirty(props.tab.state, saved.value));
const canSave = computed(() => props.tab.state.itemId !== null && saved.value !== null);

function onSave(): void {
  const itemId = props.tab.state.itemId;
  if (!itemId || !saved.value) {
    onSaveAs();
    return;
  }
  void saveGrpcRequest(
    itemId,
    props.tab.state.name || title.value,
    toSavedGrpcRequest(props.tab.state),
  );
}

function onSaveAs(): void {
  openSaveGrpcDialog(
    props.tab.id,
    props.tab.state.name || title.value,
    toSavedGrpcRequest(props.tab.state),
  );
}

function onCall(): void {
  void call(props.tab.id);
}

function onStop(): void {
  stop(props.tab.id);
}

const collectionId = computed(() => collectionIdFor(props.tab.state));
watch(
  [collectionId, activeEnvironmentId],
  ([cid, eid]) => {
    void ensureVariablesLoaded('collection', cid);
    void ensureVariablesLoaded('environment', eid);
  },
  { immediate: true },
);
const unresolvedRefs = computed(() => {
  const { values, secretNames } = mergedValuesAndSecrets(
    collectionId.value,
    activeEnvironmentId.value,
  );
  const refs = resolveGrpcTabState(props.tab.state, values, secretNames).refs;
  const byName = new Map(
    refs
      .filter((r) => r.kind === 'unknown' || (r.kind === 'dynamic' && !isDynamicName(r.name)))
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
  unregisterCommands = [
    registerCommand('view.run', onCall),
    registerCommand('view.refresh', onCall),
    registerCommand('view.format', onBeautify),
    registerCommand('api.save', onSave),
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
  clearTimeout(schemaLoadTimer);
});
</script>

<template>
  <div class="grpc-request-view" data-testid="grpc-request-view">
    <ViewChrome
      :tab="tab"
      icon="symbol-interface"
      :name="title"
      target-testid="grpc-request-target"
      refresh-testid="grpc-request-refresh"
      stop-testid="grpc-request-stop"
      :can-stop="running"
      @refresh="onCall"
      @stop="onStop"
    >
      <template #badges>
        <span v-if="tab.state.service && tab.state.method" class="p-chip info" data-testid="grpc-method-chip">
          {{ tab.state.service }}/{{ tab.state.method }}
        </span>
        <span v-if="dirty" class="dirty-mark" data-testid="grpc-dirty" v-tooltip="'Unsaved changes'">•</span>
        <span
          v-if="unresolvedRefs.length > 0"
          class="p-chip warn"
          data-testid="grpc-unresolved-chip"
          v-tooltip="unresolvedTooltip"
        >
          {{ unresolvedRefs.length }} unresolved
        </span>
      </template>

      <template #toolbar>
        <TextField
          :model-value="tab.state.target"
          placeholder="api.example.com:443"
          style="flex: 1"
          data-testid="grpc-target"
          @update:model-value="onTargetInput"
          @enter="onCall"
        />
        <SegmentedControl
          :model-value="tab.state.tlsMode"
          :options="TLS_OPTIONS"
          data-testid="grpc-tls-toggle"
          @update:model-value="setTlsMode"
        />
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
        <AppButton
          icon="save"
          data-testid="grpc-save"
          :disabled="canSave && !dirty"
          v-tooltip="canSave ? 'Save request' : 'Save request to a collection'"
          @click="onSave"
        >
          Save
        </AppButton>
        <AppButton
          icon="play"
          variant="primary"
          data-testid="grpc-call"
          :disabled="running || !tab.state.service || !tab.state.method"
          v-tooltip="'Call'"
          @click="onCall"
        >
          Call
        </AppButton>
      </template>

      <template #toolbar-2>
        <SegmentedControl
          :model-value="tab.state.requestPane"
          :options="REQUEST_PANE_OPTIONS"
          data-testid="grpc-request-pane-toggle"
          @update:model-value="setRequestPane"
        />
        <IconButton
          v-if="tab.state.requestPane === 'message'"
          icon="expand-all"
          v-tooltip="'Beautify'"
          data-testid="grpc-beautify"
          @click="onBeautify"
        />
        <IconButton
          v-if="tab.state.requestPane === 'metadata'"
          icon="search"
          :active="fieldFilterOpen"
          v-tooltip="'Filter'"
          data-testid="grpc-field-filter-toggle"
          @click="toggleFieldFilter"
        />
        <EnvironmentSelect />
      </template>

      <div class="request-response-split">
        <div class="request-pane" :style="{ flex: `0 0 ${requestPaneHeight}px` }" data-testid="grpc-request-pane">
          <CodeMirrorHost
            v-if="tab.state.requestPane === 'message'"
            :doc="tab.state.message"
            language="json"
            :read-only="false"
            data-testid="grpc-message-editor"
            @update:doc="onMessageInput"
          />
          <template v-else-if="tab.state.requestPane === 'metadata'">
            <PanelSearchBox
              v-if="fieldFilterOpen"
              v-model="fieldFilterQuery"
              placeholder="Filter"
              testid="grpc-field-filter"
            />
            <MetadataTable :tab="tab" :filter-query="fieldFilterQuery" />
          </template>
          <SchemaBrowser v-else :tab="tab" />
        </div>

        <PanelSplitter
          class="request-splitter"
          orientation="row"
          :size="requestPaneHeight"
          :min="120"
          :max="800"
          @resize="onResizeRequestPane"
        />

        <div class="response-pane-slot" data-testid="grpc-response-pane-slot">
          <ResponsePane :tab="tab" />
        </div>
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.grpc-request-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.request-response-split {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.request-pane {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.request-splitter {
  height: var(--kira-s-2);
  flex-shrink: 0;
}

.dirty-mark {
  color: var(--kira-warn);
  font-size: var(--kira-t-lg);
  line-height: 1;
}

.response-pane-slot {
  flex: 1;
  min-height: 0;
}
</style>
