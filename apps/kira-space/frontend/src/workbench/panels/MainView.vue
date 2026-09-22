<script setup lang="ts">
import { computed } from 'vue';
import GitStart from '../../repo/GitStart.vue';
import type { SpaceTabKind } from '../../state/tabKinds';
import { useTabsStore } from '../../state/tabs';
import { useWorkspaceStore } from '../../state/workspace';
import { TAB_VIEWS } from '../tabViews';

// P100 Part 2: Kira Studio's own workbench/panels/MainView.vue, trimmed — no MODES registry (one
// module), so there is no per-mode "start" component lookup: GitStart.vue (this app's own "no
// repository open" empty state) is the one fallback, shown whenever the active workspace has no
// active tab — no repository open at all (GENERAL_WORKSPACE) or a repository open with every tab
// closed.
const tabsStore = useTabsStore();
const workspaceStore = useWorkspaceStore();

const activeTab = computed(() => {
  const id = tabsStore.activeIdByWorkspace[workspaceStore.active];
  return id ? (tabsStore.tabs.find((t) => t.id === id) ?? null) : null;
});
</script>

<template>
  <component
    :is="TAB_VIEWS[activeTab.kind as SpaceTabKind]"
    v-if="activeTab"
    :key="activeTab.id"
    :tab="activeTab"
  />
  <GitStart v-if="!activeTab" />
</template>
