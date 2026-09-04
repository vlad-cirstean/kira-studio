<script setup lang="ts">
import { statusClass } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
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
        <span class="p-push" />
        <SegmentedControl
          :model-value="tab.state.responsePane"
          :options="RESPONSE_PANE_OPTIONS"
          data-testid="http-response-pane-toggle"
          @update:model-value="setResponsePane"
        />
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
        <CodeMirrorHost v-else :doc="response.body" language="plain" :read-only="true" />
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
