<script setup lang="ts">
import EmptyState from '@theme/components/EmptyState.vue';
import { EmptyDescription } from '@theme/components/ui/empty';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
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
  <EmptyState
    fill
    data-testid="empty-repository-panel"
    :icon="STATE_ICONS.commit"
    :title="t('git.emptyRepository.title')"
  >
    <EmptyDescription class="max-w-105">
      <CatalogText k="git.emptyRepository.description">
        <template #branch><strong>{{ branchName }}</strong></template>
      </CatalogText>
    </EmptyDescription>
  </EmptyState>
</template>
