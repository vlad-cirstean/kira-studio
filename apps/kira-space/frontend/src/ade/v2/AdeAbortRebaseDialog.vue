<script setup lang="ts">
import ConfirmDialogView from '@workbench/components/ConfirmDialogView.vue';
import { computed } from 'vue';
import { useAdeDialogsStore } from './state/adeDialogs';
import { useConfirmRun } from './useConfirmRun';

// Abort rebase asks first: it throws away the half-done rebase in the worktree.
const dialogs = useAdeDialogsStore();
const title = computed(() => `Abort the rebase of ${dialogs.abortTarget?.name ?? ''}?`);
const { busy, error, confirm } = useConfirmRun(
  () => dialogs.abortTarget !== null,
  dialogs.confirmAbort,
  () => {
    dialogs.abortTarget = null;
  },
);
</script>

<template>
  <ConfirmDialogView
    :open="dialogs.abortTarget !== null"
    :title="title"
    message="Runs git rebase --abort: the branch returns to where it was before the rebase. The base stays changed until a rebase completes."
    confirm-label="Abort rebase"
    cancel-label="Keep"
    tone="danger"
    :busy="busy"
    :error="error ?? ''"
    :testids="{ root: 'ade-confirm-dialog', cancel: 'ade-confirm-no', confirm: 'ade-confirm-yes', error: 'ade-confirm-error' }"
    @confirm="confirm"
    @cancel="dialogs.abortTarget = null"
  />
</template>
