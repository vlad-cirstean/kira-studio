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

// P72 §3: an explicit `include`, not a blanket `KeepAlive` — the graph tab's own layout is what
// tearing down loses (RepoGraphView.vue's own doc comment: a mere tab switch destroys git-ui's
// whole nested app, so its computed lane layout is rebuilt from scratch on return). Widening this
// to every tab kind would silently change the lifetime of every data grid/console/stream tab in
// the app too — a different phase's decision, not something this row asked for.
const KEEP_ALIVE_VIEWS = ['RepoGraphView'];
// One cached instance per open repo workspace is the realistic ceiling (the graph tab is
// `pinned: true`, at most one per workspace, tabKinds.ts) — bounded here so that stays a
// guarantee, not an assumption.
const KEEP_ALIVE_MAX = 20;
</script>

<template>
  <KeepAlive :include="KEEP_ALIVE_VIEWS" :max="KEEP_ALIVE_MAX">
    <component :is="TAB_VIEWS[activeTab.kind]" v-if="activeTab" :key="activeTab.id" :tab="activeTab" />
  </KeepAlive>
  <component :is="modeStart" v-if="!activeTab" />
</template>
