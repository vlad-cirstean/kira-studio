<script setup lang="ts">
import { moduleOfWorkspace } from '@shared/domain/workspace';
import { computed } from 'vue';
import { activeTab } from '../../state/mode';
import { workspaceState } from '../../state/workspace';
import { MODES } from '../modes';
import { TAB_VIEWS } from '../tabViews';

// P1 D6/C6: no active tab in the current mode falls back to that mode's own start component
// (StudioStart for Studio, api/ApiStart for Api, repo/GitStart for Git) instead of a hardcoded
// <StudioStart />. P67b §4.1: one dispatch expression — a repo workspace falls back to
// GitStart.vue via moduleOfWorkspace, in practice unreachable (every repo workspace always has at
// least its pinned graph tab, ensureWorkspaceShell's own guarantee), kept for the same reason
// MainView keeps a fallback for studio/api at all.
const modeStart = computed(() => MODES[moduleOfWorkspace(workspaceState.active)].start);
</script>

<template>
  <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  <component :is="modeStart" v-else />
</template>
