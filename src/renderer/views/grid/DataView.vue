<script setup lang="ts">
import type { TabRecord } from '@shared/domain/tabs';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { registerCommand } from '../../shortcuts/commands';
import { connectConnection, connectionsState } from '../../state/connections';
import { isHydrated, markHydrated } from '../../state/tabs';
import Codicon from '../../theme/Codicon.vue';
import DataGrid from './DataGrid.vue';
import SearchToolbar from './SearchToolbar.vue';
import { cancelPrefetch, load, reload, runtime } from './state';

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

let unregisterCommands: Array<() => void> = [];

onMounted(() => {
  if (!needsReconnect.value && !runtime[props.tab.id]) {
    void load(props.tab.id);
  }
  // D11: this component is mounted only while its tab is the active one (MainView.vue's
  // `v-else-if` chain), so registering here — rather than switching on tab kind in a global
  // dispatcher — is what makes Find/Refresh always act on the currently visible data tab.
  unregisterCommands = [
    registerCommand('view.find', () => {
      const rt = runtime[props.tab.id];
      if (rt) rt.searchOpen = !rt.searchOpen;
    }),
    registerCommand('view.refresh', () => void reload(props.tab.id)),
  ];
});

// This component is remounted per tab switch (see the note above) — its unmount is the natural
// place to cancel whatever prefetch was pending for the tab being switched away from.
onUnmounted(() => {
  cancelPrefetch(props.tab.id);
  for (const off of unregisterCommands) off();
});

const dataGridRef = ref<{ scrollCellIntoView: (row: number, col: number) => void } | null>(null);

function onGoToMatch(row: number, col: number): void {
  dataGridRef.value?.scrollCellIntoView(row, col);
}
function onCloseSearch(): void {
  const runtimeEntry = runtime[props.tab.id];
  if (runtimeEntry) runtimeEntry.searchOpen = false;
}
</script>

<template>
  <div class="data-view">
    <div v-if="needsReconnect" class="reconnect-panel" data-testid="reconnect-panel">
      <button type="button" class="p-dlgbtn primary" data-testid="reconnect-load" @click="onReconnectAndLoad">
        Reconnect &amp; load
      </button>
    </div>
    <template v-else>
      <!-- P16 design system LAW: work-in-progress is the ring + elapsed time beside the button
           that started it (DataToolbar's p-run-state), never a bar across the top of the view —
           §8.5's "never a spinner that replaces the previous page" still holds, it just no longer
           needs a bar of its own to say so. -->
      <div
        v-if="rt?.status === 'error' && rt.error"
        class="error-strip p-strip err"
        data-testid="error-strip"
      >
        <span class="icon-box"><Codicon name="warning" :size="14" /></span>
        <span>{{ rt.error.message }}</span>
      </div>
      <div class="grid-area">
        <DataGrid ref="dataGridRef" :tab-id="tab.id" />
        <SearchToolbar
          v-if="rt?.searchOpen"
          :tab-id="tab.id"
          @go-to-match="onGoToMatch"
          @close="onCloseSearch"
        />
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

.error-strip {
  font-family: var(--kira-font-family);
  white-space: pre-wrap;
}

.grid-area {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>
