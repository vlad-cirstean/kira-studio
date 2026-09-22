<script setup lang="ts">
import { computed } from 'vue';
import { useWorkbenchHost } from '../host';

// P103 Part 2 (§5.4): Kira Studio's own workbench/panels/MainView.vue and Kira Space's, unified —
// `views[activeTab.kind]` now resolves through the provided WorkbenchHost instead of a
// module-level TAB_VIEWS import, so this file no longer needs either app's own tab-kind union.
//
// The "no active tab" fallback (Kira Studio: the active mode's own `start` component from its
// MODES registry; Kira Space: GitStart.vue, its one module's empty state) stays out of the host —
// it's App-composition content, not a tab-kind concern — and arrives through the `#empty` slot
// instead, each app passing whatever component its own workspace-switch logic already resolves.
const host = useWorkbenchHost();

const activeTab = computed(() => {
  const id = host.tabs.activeIdByWorkspace[host.activeWorkspace.value];
  return id ? (host.tabs.tabs.find((t) => t.id === id) ?? null) : null;
});
</script>

<template>
  <component :is="host.views[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  <slot v-else name="empty" />
</template>
