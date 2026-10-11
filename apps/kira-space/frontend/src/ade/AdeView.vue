<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@theme/components/ui/empty';
import { t } from '@theme/i18n';
import { useReposDialogStore } from '../repo/state/reposDialog';
import { useCodeReposStore } from '../state/coderepos';
import AdeShell from './v2/shell/AdeShell.vue';

// The `ade` mode's root: the v2 shell, or the empty state until a repository is imported.
const codeReposStore = useCodeReposStore();
const reposDialog = useReposDialogStore();
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="ade-view">
    <Empty v-if="codeReposStore.records.length === 0" class="h-full">
      <EmptyHeader>
        <EmptyMedia>
          <CodiconIcon name="robot" :size="24" />
        </EmptyMedia>
        <EmptyTitle>{{ t('space.ade.view.empty.title') }}</EmptyTitle>
        <EmptyDescription>{{ t('space.ade.view.empty.hint') }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="dialog-primary" size="kira-lg" data-testid="ade-import" @click="reposDialog.show()">
          <CodiconIcon name="repo" :size="13" />
          {{ t('space.ade.view.import.label') }}
        </Button>
      </EmptyContent>
    </Empty>
    <AdeShell v-else />
  </div>
</template>
