<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { t } from '@theme/i18n';
import ModuleStart from '@workbench/components/ModuleStart.vue';
import { useReposDialogStore } from './state/reposDialog';

const reposDialog = useReposDialogStore();
</script>

<template>
  <ModuleStart icon="source-control" :title="t('space.repo.noRepoOpen.empty')" data-testid="git-start">
    <Button variant="dialog-primary" size="kira-lg" data-testid="git-start-import" @click="reposDialog.show()">
      <CodiconIcon name="repo" :size="13" />
      {{ t('space.repo.manage.label') }}
    </Button>
  </ModuleStart>
</template>
