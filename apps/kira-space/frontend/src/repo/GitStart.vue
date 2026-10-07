<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertAction, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { useReposDialogStore } from './state/reposDialog';

const reposDialog = useReposDialogStore();
</script>

<template>
  <div class="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4" data-testid="git-start">
    <div class="w-105 max-w-full">
      <Alert class="w-full flex-col items-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="source-control" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No repository open</AlertTitle>
        <AlertAction class="static mt-1 flex flex-col items-center gap-1.5">
          <Button variant="dialog-primary" size="kira-lg" data-testid="git-start-import" @click="reposDialog.show()">
            <CodiconIcon name="repo" :size="13" />
            Manage repositories…
          </Button>
        </AlertAction>
      </Alert>
    </div>
  </div>
</template>
