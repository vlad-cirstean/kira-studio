<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkbenchHost } from '../host';

// Kira Studio's own workbench/panels/MainView.vue and Kira Space's, unified —
// `views[activeTab.kind]` now resolves through the provided WorkbenchHost instead of a
// module-level TAB_VIEWS import, so this file no longer needs either app's own tab-kind union.
//
// The "no active tab" fallback (Kira Studio: the active mode's own `start` component from its
// MODES registry; Kira Space: GitStart.vue, its one module's empty state) stays out of the host —
// it's App-composition content, not a tab-kind concern — and arrives through the `#empty` slot
// instead, each app passing whatever component its own workspace-switch logic already resolves.
const host = useWorkbenchHost();

// Kinds with `keepMounted` stay mounted (v-show) from first activation until the tab closes.
const activeTab = computed(() => {
  const id = host.tabs.activeIdByWorkspace[host.activeWorkspace.value];
  return id ? (host.tabs.tabs.find((t) => t.id === id) ?? null) : null;
});

const visited = ref<string[]>([]);
watch(
  activeTab,
  (tab) => {
    if (tab && host.kinds[tab.kind]?.keepMounted && !visited.value.includes(tab.id)) {
      visited.value.push(tab.id);
    }
  },
  { immediate: true },
);
watch(
  () => host.tabs.tabs.map((t) => t.id),
  (ids) => {
    visited.value = visited.value.filter((id) => ids.includes(id));
  },
);
const keptTabs = computed(() => host.tabs.tabs.filter((t) => visited.value.includes(t.id)));
</script>

<template>
  <component
    :is="host.views[tab.kind]"
    v-for="tab in keptTabs"
    v-show="tab.id === activeTab?.id"
    :key="tab.id"
    :tab="tab"
    :active="tab.id === activeTab?.id"
  />
  <component
    :is="host.views[activeTab.kind]"
    v-if="activeTab && !host.kinds[activeTab.kind]?.keepMounted"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <slot v-if="!activeTab" name="empty" />
</template>
