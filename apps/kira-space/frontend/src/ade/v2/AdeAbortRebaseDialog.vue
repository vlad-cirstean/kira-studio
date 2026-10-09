<script setup lang="ts">
import { computed } from 'vue';
import AdeConfirmDialog from './AdeConfirmDialog.vue';
import { useAdeDialogsStore } from './state/adeDialogs';

// Abort rebase asks first: it throws away the half-done rebase in the worktree.
const dialogs = useAdeDialogsStore();
const title = computed(() => `Abort the rebase of ${dialogs.abortTarget?.name ?? ''}?`);
</script>

<template>
  <AdeConfirmDialog
    :open="dialogs.abortTarget !== null"
    :title="title"
    text="Runs git rebase --abort: the branch returns to where it was before the rebase. The base stays changed until a rebase completes."
    yes-label="Abort rebase"
    no-label="Keep"
    :run="dialogs.confirmAbort"
    @close="dialogs.abortTarget = null"
  />
</template>
