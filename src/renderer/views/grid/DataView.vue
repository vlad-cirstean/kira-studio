<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed, onMounted } from 'vue';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import DataGrid from './DataGrid.vue';
import { load, runtime } from './state';

// MainView.vue keys this component by tab.id, so one instance <-> one tab: onMounted below
// fires fresh on every tab switch, which is what makes per-tab load-on-activate and scroll
// restore (DataGrid's own onMounted) work without a manual watcher.
const props = defineProps<{ tab: TabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4: a restored tab shows only this button until pressed — nothing loads automatically.
const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

const rt = computed(() => runtime[props.tab.id]);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
  await load(props.tab.id);
}

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
});
</script>

<template>
  <div class="data-view">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="reconnect-panel">
      <button type="button" data-testid="reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <!-- A thin indeterminate bar, never a spinner that replaces the previous page (§8.5). -->
      <div v-if="rt?.status === 'loading'" class="loading-bar" data-testid="loading-bar" />
      <div
        v-if="rt?.status === 'error' && rt.error"
        class="error-strip"
        data-testid="error-strip"
      >
        {{ rt.error.message }}
      </div>
      <div class="grid-area">
        <DataGrid :tab-id="tab.id" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.data-view {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.reconnect-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.reconnect-panel button {
  padding: 6px 14px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  cursor: pointer;
  font-size: 12px;
}

.reconnect-panel button:hover {
  background: var(--kira-hover);
}

.loading-bar {
  height: 2px;
  flex-shrink: 0;
  background: linear-gradient(90deg, transparent, var(--kira-accent), transparent);
  background-size: 200% 100%;
  animation: loading-sweep 1.2s linear infinite;
}

@keyframes loading-sweep {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

.error-strip {
  flex-shrink: 0;
  padding: 4px 8px;
  font-size: 11px;
  font-family: var(--kira-font-family);
  color: var(--kira-error);
  background: var(--kira-bg-elevated);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  white-space: pre-wrap;
}

.grid-area {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
