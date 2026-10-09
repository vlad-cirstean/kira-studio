<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyDescription, EmptyMedia } from '@theme/components/ui/empty';
/**
 * §6.2's "repository with no commits" state — an unborn HEAD (P1 detects it; P2's store renders
 * it as zero rows). A one-line explanation, not an empty list with a scrollbar: showing the real
 * `CommitGrid.vue` here would just be a blank rectangle with nothing to explain why.
 *
 * Takes `head: HeadState` narrowed to the unborn variant rather than the whole `RepoSummary` —
 * this panel only ever needs the branch name unborn HEAD points at.
 */
import { codiconName, STATE_ICONS } from '../icons/index.ts';

defineProps<{ branchName: string }>();
</script>

<template>
  <Empty class="h-full p-6" data-testid="empty-repository-panel">
    <EmptyMedia variant="icon">
      <CodiconIcon :name="codiconName(STATE_ICONS.commit)" :size="24" />
    </EmptyMedia>
    <EmptyDescription class="max-w-105">
      This repository has no commits yet. Create the first one on
      <strong>{{ branchName }}</strong> to see it here.
    </EmptyDescription>
  </Empty>
</template>
