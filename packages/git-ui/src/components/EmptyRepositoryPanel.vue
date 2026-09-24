<script setup lang="ts">
/**
 * §6.2's "repository with no commits" state — an unborn HEAD (P1 detects it; P2's store renders
 * it as zero rows). A one-line explanation, not an empty list with a scrollbar: showing the real
 * `CommitGrid.vue` here would just be a blank rectangle with nothing to explain why.
 *
 * Takes `head: HeadState` narrowed to the unborn variant rather than the whole `RepoSummary` —
 * this panel only ever needs the branch name unborn HEAD points at.
 */
import { STATE_ICONS } from '../icons/index.ts';

defineProps<{ branchName: string }>();
</script>

<template>
  <div
    class="kv:flex kv:flex-col kv:items-center kv:justify-center kv:gap-2 kv:h-full kv:p-4 kv:text-center kv:text-fg"
    data-testid="empty-repository-panel"
  >
    <span
      class="codicon kv:text-[24px] kv:text-muted"
      :class="STATE_ICONS.commit"
      aria-hidden="true"
    ></span>
    <p class="kv:m-0 kv:max-w-[420px] kv:text-muted">
      This repository has no commits yet. Create the first one on
      <strong>{{ branchName }}</strong> to see it here.
    </p>
  </div>
</template>
