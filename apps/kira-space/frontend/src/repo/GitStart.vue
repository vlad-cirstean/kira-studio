<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyContent, EmptyMedia, EmptyTitle } from '@theme/components/ui/empty';
import { t } from '@theme/i18n';
import { useReposDialogStore } from './state/reposDialog';

const reposDialog = useReposDialogStore();
</script>

<template>
  <div class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="git-start">
    <div class="w-105 max-w-full">
      <Empty class="w-full">
        <EmptyMedia><CodiconIcon name="source-control" :size="24" /></EmptyMedia>
        <EmptyTitle>{{ t('space.repo.noRepoOpen.empty') }}</EmptyTitle>
        <EmptyContent>
          <Button variant="dialog-primary" size="kira-lg" data-testid="git-start-import" @click="reposDialog.show()">
            <CodiconIcon name="repo" :size="13" />
            {{ t('space.repo.manage.label') }}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  </div>
</template>
