<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';

const props = defineProps<{ tab: TabRecord }>();

const connectionStatus = computed(() =>
  props.tab.connectionId
    ? (connectionsState.states[props.tab.connectionId]?.status ?? 'disconnected')
    : 'disconnected',
);

// §8.4: a restored tab renders only this button until pressed — nothing loads automatically.
const needsReconnect = computed(
  () => !isHydrated(props.tab.id) || connectionStatus.value !== 'connected',
);

async function onReconnectAndLoad(): Promise<void> {
  if (!props.tab.connectionId) return;
  if (connectionStatus.value !== 'connected') {
    await connectConnection(props.tab.connectionId);
  }
  markHydrated(props.tab.id);
}
</script>

<template>
  <div class="data-view">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="reconnect-panel">
      <button type="button" data-testid="reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <div v-else class="grid-placeholder" data-testid="data-view-placeholder">
      <!-- The grid, toolbars and search overlay land in Step 8. -->
    </div>
  </div>
</template>

<style scoped>
.data-view {
  height: 100%;
  display: flex;
  flex-direction: column;
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

.grid-placeholder {
  flex: 1;
}
</style>
