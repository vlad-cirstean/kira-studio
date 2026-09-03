<script setup lang="ts">
/**
 * §6.2's "repository with no commits" state — an unborn HEAD (P1 detects it; P2's store renders
 * it as zero rows). A one-line explanation, not an empty list with a scrollbar: showing the real
 * `CommitGrid.vue` here would just be a blank rectangle with nothing to explain why.
 *
 * Takes `head: HeadState` narrowed to the unborn variant rather than the whole `RepoSummary` —
 * this panel only ever needs the branch name unborn HEAD points at.
 */
import { STATE_ICONS } from "../icons/index.ts";

defineProps<{ branchName: string }>();
</script>

<template>
  <div class="kv-empty-repo-panel" data-testid="empty-repository-panel">
    <span class="codicon kv-empty-repo-icon" :class="STATE_ICONS.commit" aria-hidden="true"></span>
    <p class="kv-empty-repo-text">
      This repository has no commits yet. Create the first one on
      <strong>{{ branchName }}</strong> to see it here.
    </p>
  </div>
</template>

<style>
.kv-empty-repo-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--kv-space-3);
  height: 100%;
  padding: var(--kv-space-5);
  text-align: center;
  color: var(--kv-app-fg);
}

.kv-empty-repo-icon {
  font-size: 24px;
  color: var(--kv-description-fg);
}

.kv-empty-repo-text {
  margin: 0;
  max-width: 420px;
  color: var(--kv-description-fg);
}
</style>
