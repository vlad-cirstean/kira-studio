<script setup lang="ts">
import type { HttpMethod } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { patchHttpRequestTabState } from '../../state/tabs';
import AppButton from '../../theme/primitives/AppButton.vue';
import PanelSplitter from '../../theme/primitives/PanelSplitter.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import ViewChrome from '../../theme/primitives/ViewChrome.vue';
import { bodyBadgeLabel } from './body';
import QueryParamsTable from './QueryParamsTable.vue';
import RequestBodyPane from './RequestBodyPane.vue';
import RequestHeadersTable from './RequestHeadersTable.vue';
import ResponsePane from './ResponsePane.vue';
import { runtime, send, stop } from './state';
import { httpRequestTitle, parseQuery, splitUrl } from './url';

// MainView.vue keys this component by tab.id — same discipline as every other *View.vue.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const running = computed(() => rt.value?.status === 'running');

const title = computed(() => httpRequestTitle(props.tab.state));

const METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// D12: a method chip coloured by method family, over .p-chip's existing variants (F17) — zero
// new CSS.
const METHOD_CLASS: Record<HttpMethod, 'info' | 'ok' | 'warn' | 'err'> = {
  GET: 'info',
  HEAD: 'info',
  OPTIONS: 'info',
  POST: 'ok',
  PUT: 'warn',
  PATCH: 'warn',
  DELETE: 'err',
};
const methodClass = computed(() => METHOD_CLASS[props.tab.state.method]);

function onMethodChange(e: Event): void {
  const method = (e.target as HTMLSelectElement).value as HttpMethod;
  patchHttpRequestTabState(props.tab.id, { method });
}

function onUrlInput(value: string): void {
  patchHttpRequestTabState(props.tab.id, { url: value });
}

function onSend(): void {
  void send(props.tab.id);
}

function onStop(): void {
  stop(props.tab.id);
}

const paramsCount = computed(() => parseQuery(splitUrl(props.tab.state.url).query).length);
const headersCount = computed(() => props.tab.state.headers.filter((h) => h.enabled).length);

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
]);

function setRequestPane(pane: 'params' | 'headers' | 'body'): void {
  patchHttpRequestTabState(props.tab.id, { requestPane: pane });
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
  ];
});
onUnmounted(() => {
  for (const off of unregisterCommands) off();
});
</script>

<template>
  <div class="http-request-view" data-testid="http-request-view">
    <ViewChrome
      :tab="tab"
      icon="globe"
      :name="title"
      target-testid="http-request-target"
      refresh-testid="http-request-refresh"
      stop-testid="http-request-stop"
      :can-stop="running"
      @refresh="onSend"
      @stop="onStop"
    >
      <template #badges>
        <span class="p-chip" :class="methodClass" data-testid="http-method-chip">{{ tab.state.method }}</span>
      </template>

      <template #toolbar>
        <select
          class="p-select bordered"
          data-testid="http-method-select"
          :value="tab.state.method"
          @change="onMethodChange"
        >
          <option v-for="m in METHODS" :key="m" :value="m">{{ m }}</option>
        </select>
        <TextField
          :model-value="tab.state.url"
          placeholder="https://api.example.com/users"
          style="flex: 1"
          data-testid="http-url"
          @update:model-value="onUrlInput"
          @enter="onSend"
        />
        <AppButton
          icon="play"
          variant="primary"
          data-testid="http-send"
          :disabled="running"
          v-tooltip="'Send'"
          @click="onSend"
        >
          Send
        </AppButton>
      </template>

      <template #toolbar-2>
        <SegmentedControl
          :model-value="tab.state.requestPane"
          :options="REQUEST_PANE_OPTIONS"
          data-testid="http-request-pane-toggle"
          @update:model-value="setRequestPane"
        />
      </template>

      <div class="request-response-split">
        <div class="request-pane" :style="{ flex: `0 0 ${requestPaneHeight}px` }" data-testid="http-request-pane">
          <QueryParamsTable v-if="tab.state.requestPane === 'params'" :tab="tab" />
          <RequestHeadersTable v-else-if="tab.state.requestPane === 'headers'" :tab="tab" />
          <RequestBodyPane v-else :tab="tab" />
        </div>

        <PanelSplitter
          class="request-splitter"
          orientation="row"
          :size="requestPaneHeight"
          :min="120"
          :max="800"
          @resize="onResizeRequestPane"
        />

        <div class="response-pane-slot" data-testid="http-response-pane-slot">
          <ResponsePane :tab="tab" />
        </div>
      </div>
    </ViewChrome>
  </div>
</template>

<style scoped>
.http-request-view {
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

/* Mirrors views/shared/celleditor/CellEditorDock.vue's own .cell-splitter comment: the workbench
   grid gives a splitter its size from a gap row; inside a view there is no gap band, so the
   track carries its own explicit height. */
.request-splitter {
  height: var(--kira-s-2);
  flex-shrink: 0;
}

.response-pane-slot {
  flex: 1;
  min-height: 0;
}
</style>
