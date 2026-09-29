<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWorkbenchHost } from '../host';
import { nextWarmIds } from '../tabs/warmTabs';

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

// Kept-alive kinds get one KeepAlive per tab: KeepAlive prunes by component name or LRU only, so
// a closed tab's view would otherwise stay cached. Default flush 'pre' runs before render, so the
// active tab's KeepAlive exists on the render that shows it.
const keepAlive = host.keepAlive;
const isWarm = (kind: string): boolean => keepAlive?.kinds.includes(kind) ?? false;
const warmIds = ref<string[]>([]);
const lastUsed = new Map<string, number>();
let stamp = 0;

watch(
  [() => activeTab.value?.id ?? null, () => host.tabs.tabs.map((t) => t.id).join('\n')],
  ([activeId]) => {
    if (!keepAlive) return;
    const tab = activeTab.value;
    warmIds.value = nextWarmIds(
      warmIds.value,
      activeId && tab && isWarm(tab.kind) ? activeId : null,
      new Set(host.tabs.tabs.map((t) => t.id)),
      lastUsed,
      ++stamp,
      keepAlive.max,
    );
  },
  { immediate: true },
);
</script>

<template>
  <template v-if="activeTab">
    <KeepAlive v-for="id in warmIds" :key="id">
      <component :is="host.views[activeTab.kind]" v-if="id === activeTab.id" :tab="activeTab" />
    </KeepAlive>
    <component
      :is="host.views[activeTab.kind]"
      v-if="!isWarm(activeTab.kind)"
      :key="activeTab.id"
      :tab="activeTab"
    />
  </template>
  <slot v-else name="empty" />
</template>
