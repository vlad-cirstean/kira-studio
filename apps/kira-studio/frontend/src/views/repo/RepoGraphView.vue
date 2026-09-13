<script setup lang="ts">
// C5 §6.2: the pinned first tab's own placeholder view — an honest "not built yet" empty state,
// not a stubbed feature (no TODO, no disabled control). C9 replaces this file's content wholesale
// with the real packages/git-ui graph mount; nothing outside TAB_VIEWS['repo-graph'] (workbench/
// tabViews.ts) needs to change for that swap.
import type { TabRecord } from '@shared/domain/tabs';
import EmptyState from '../../theme/primitives/EmptyState.vue';

// Optional: TAB_VIEWS mounts this with `:tab="activeTab"` (every tab view's own shape);
// workbench/modes.ts's REPO_WORKSPACE.start mounts it with no tab at all (MainView's own
// no-active-tab fallback) — this view needs neither, so both are simply absorbed.
defineProps<{ tab?: TabRecord }>();
</script>

<template>
  <EmptyState
    icon="source-control"
    label="The commit graph for this repository is not available yet."
  />
</template>
