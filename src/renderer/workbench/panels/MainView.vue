<script setup lang="ts">
import { computed } from 'vue';
import DataGrid from '../DataGrid.vue';
import ReconnectPrompt from '../ReconnectPrompt.vue';
import Codicon from '../../theme/Codicon.vue';
import EmptyState from './EmptyState.vue';
import { loadTabData } from '../state/data';
import { findDataTab, getPage, tabsState } from '../state/tabs';

// §8.4 / Step 9: the tab-body switch. `restored` → ReconnectPrompt, `error` → the server message
// with Retry, `loading` with no page → centred spinner, `ready` → DataGrid, no tabs → EmptyState.
// P2 owns `data` tabs; a `ddl` tab (P4) is out of scope here.

const activeTab = computed(() => {
  if (tabsState.activeId === null) return null;
  return findDataTab(tabsState.activeId);
});

const view = computed(() => {
  const tab = activeTab.value;
  if (!tab) return { kind: 'empty' as const };
  if (tab.runtime.status === 'restored') return { kind: 'restored' as const, tab };
  if (tab.runtime.status === 'error') return { kind: 'error' as const, tab };
  const page = getPage(tab.id);
  if (tab.runtime.status === 'loading' && !page) return { kind: 'loading' as const };
  return { kind: 'ready' as const, tab };
});

function retry(): void {
  const tab = activeTab.value;
  if (tab) void loadTabData(tab.id, { refresh: true });
}
</script>

<template>
  <div class="main-view">
    <EmptyState v-if="view.kind === 'empty'" icon="table" label="No tab open" />
    <ReconnectPrompt v-else-if="view.kind === 'restored'" :tab="view.tab" />
    <div v-else-if="view.kind === 'loading'" class="centered">
      <Codicon name="sync" :size="22" class="spin" />
    </div>
    <div v-else-if="view.kind === 'error'" class="centered error-state" data-testid="tab-error">
      <Codicon name="error" :size="22" />
      <p class="error-text">{{ view.tab.runtime.error }}</p>
      <button type="button" class="retry" data-testid="tab-retry" @click="retry">Retry</button>
    </div>
    <DataGrid v-else :key="view.tab.id" :tab="view.tab" />
  </div>
</template>

<style scoped>
.main-view {
  height: 100%;
  overflow: hidden;
}

.centered {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--kira-fg-muted);
}

.spin {
  animation: kira-spin 1s linear infinite;
}

@keyframes kira-spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state {
  color: var(--kira-error);
}

.error-text {
  color: var(--kira-fg-muted);
  font-size: 12px;
  max-width: 420px;
  text-align: center;
  word-break: break-word;
}

.retry {
  padding: 4px 12px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  background: var(--kira-bg-input);
  color: var(--kira-fg);
  font-size: 12px;
  cursor: pointer;
}

.retry:hover {
  background: var(--kira-hover);
}
</style>
