<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Empty, EmptyDescription, EmptyMedia } from '@theme/components/ui/empty';
import { CatalogText } from '@theme/i18n';
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
    <EmptyMedia>
      <CodiconIcon :name="codiconName(STATE_ICONS.commit)" :size="24" />
    </EmptyMedia>
    <EmptyDescription class="max-w-105">
      <CatalogText k="git.emptyRepository.description">
        <template #branch><strong>{{ branchName }}</strong></template>
      </CatalogText>
    </EmptyDescription>
  </Empty>
</template>
