<script setup lang="ts">
import { statusClass, statusHint } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { beautifyJson, scanJson } from '../../beautify';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { formatBytes } from '../../format';
import { patchHttpRequestTabState } from '../../state/tabs';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { runtime } from './state';

const props = defineProps<{ tab: HttpRequestTabRecord }>();

const rt = computed(() => runtime[props.tab.id]);
const response = computed(() => rt.value?.response ?? null);

const RESPONSE_PANE_OPTIONS = [
  { value: 'body' as const, label: 'Body', testid: 'http-response-pane-body' },
  { value: 'headers' as const, label: 'Headers', testid: 'http-response-pane-headers' },
];

function setResponsePane(pane: 'body' | 'headers'): void {
  patchHttpRequestTabState(props.tab.id, { responsePane: pane });
}

// D12/C6: scanJson is the one "is this JSON" gate in the app (F13) — the Pretty/Raw toggle only
// exists when there is something to prettify.
const isJson = computed(() => (response.value ? scanJson(response.value.body).ok : false));

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

// D12: a view toggle, never an edit — Pretty renders beautifyJson(raw, 'indented'), Raw renders
// the bytes exactly as received. Neither ever mutates response.body itself (it is read-only
// runtime state, D6), so switching back to Raw always shows what the server actually sent.
const bodyText = computed(() => {
  const r = response.value;
  if (!r) return '';
  if (isJson.value && props.tab.state.responseView === 'pretty') {
    return beautifyJson(r.body, 'indented').text;
  }
  return r.body;
});
</script>

<template>
  <div class="response-pane" data-testid="http-response-pane">
    <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="http-send-error">
      {{ rt.error.message }}
    </MessageStrip>

    <template v-if="response">
      <div class="response-status-row p-toolbar">
        <span class="p-chip" :class="statusClass(response.status)" data-testid="http-status">
          {{ response.status }} {{ response.statusText }}
        </span>
        <span class="p-xs muted status-hint" v-tooltip="hint" data-testid="http-status-hint">{{ hint }}</span>
        <span class="p-push" />
        <span class="p-xs dim" data-testid="http-elapsed">{{ response.elapsedMs }} ms</span>
        <span class="p-xs dim" data-testid="http-body-bytes">{{ formatBytes(response.bodyBytes) }}</span>
        <SegmentedControl
          v-if="tab.state.responsePane === 'body' && isJson"
          :model-value="tab.state.responseView"
          :options="RESPONSE_VIEW_OPTIONS"
          data-testid="http-response-view-toggle"
          @update:model-value="setResponseView"
        />
        <SegmentedControl
          :model-value="tab.state.responsePane"
          :options="RESPONSE_PANE_OPTIONS"
          data-testid="http-response-pane-toggle"
          @update:model-value="setResponsePane"
        />
      </div>

      <MessageStrip v-if="response.bodyTruncated" tone="warn" data-testid="http-body-truncated">
        Response truncated at {{ formatBytes(response.bodyBytes) }} — the server sent more than that.
      </MessageStrip>
      <div v-if="redirectCaption" class="p-xs dim redirect-caption" data-testid="http-redirects">
        {{ redirectCaption }}
      </div>

      <div v-if="tab.state.responsePane === 'headers'" class="response-headers" data-testid="http-response-headers">
        <div v-for="(h, i) in response.headers" :key="i" class="response-header-row">
          <span class="header-name mono">{{ h.name }}</span>
          <span class="header-value mono">{{ h.value }}</span>
        </div>
      </div>
      <div v-else class="response-body">
        <span v-if="response.bodyEncoding === 'base64'" class="p-sm muted binary-note" data-testid="http-response-binary">
          {{ response.bodyBytes }} bytes of binary data
        </span>
        <CodeMirrorHost
          v-else
          :doc="bodyText"
          :language="isJson ? 'json' : 'plain'"
          :read-only="true"
        />
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
</style>
