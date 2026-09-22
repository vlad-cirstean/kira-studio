<script setup lang="ts">
import { computed } from 'vue';
import { useModeStore } from '../../state/mode';
import { MODES } from '../modes';
import { TAB_VIEWS } from '../tabViews';

const modeStore = useModeStore();

// P1 D6/C6: no active tab in the current mode falls back to that mode's own start component
// (StudioStart for Studio, api/ApiStart for Api) instead of a hardcoded <StudioStart />.
// P100 Part 2: the repo-workspace fallback (GitStart.vue, via moduleOfWorkspace) moved to
// apps/kira-space wholesale along with 'git' itself — mode is directly the lookup key now.
const modeStart = computed(() => MODES[modeStore.active].start);

// P72 §3: this used to wrap the switched-in component in a KeepAlive scoped to just the repo-graph
// tab's own component name — a mere tab switch must not lose its computed lane layout (the doc
// comment lived on RepoGraphView.vue itself). P100 Part 2: that view moved to apps/kira-space
// wholesale with the rest of the repo workspace, and no kind left in this app's own TAB_VIEWS
// needs the same treatment — every one already tears down and rebuilds cheaply on switch — so
// there is nothing left for a KeepAlive here to preserve.
</script>

<template>
  <component
    :is="TAB_VIEWS[modeStore.activeTab.kind]"
    v-if="modeStore.activeTab"
    :key="modeStore.activeTab.id"
    :tab="modeStore.activeTab"
  />
  <component :is="modeStart" v-if="!modeStore.activeTab" />
</template>
