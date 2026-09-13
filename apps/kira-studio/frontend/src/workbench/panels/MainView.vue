<script setup lang="ts">
import { isRepoWorkspace } from '@shared/domain/workspace';
import { computed } from 'vue';
import { activeTab, modeState } from '../../state/mode';
import { workspaceState } from '../../state/workspace';
import { MODES, REPO_WORKSPACE } from '../modes';
import { TAB_VIEWS } from '../tabViews';

// P1 D6/C6: no active tab in the current mode falls back to that mode's own start component
// (StudioStart for Studio, api/ApiStart for Api) instead of a hardcoded <StudioStart />. C5 §4.3:
// a repo workspace falls back to REPO_WORKSPACE.start instead — in practice unreachable (every
// repo workspace always has at least its pinned graph tab, ensureWorkspaceShell's own guarantee),
// kept for the same reason MainView keeps a fallback for studio/api at all.
const modeStart = computed(() =>
  isRepoWorkspace(workspaceState.active) ? REPO_WORKSPACE.start : MODES[modeState.active].start,
);
</script>

<template>
  <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  <component :is="modeStart" v-else />
</template>
