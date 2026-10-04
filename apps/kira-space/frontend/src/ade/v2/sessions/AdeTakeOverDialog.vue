<script setup lang="ts">
import AdeConfirmDialog from '../AdeConfirmDialog.vue';
import { useAdeTakeOverStore } from '../state/adeTakeOver';

const takeOver = useAdeTakeOverStore();
</script>

<template>
  <AdeConfirmDialog
    :open="takeOver.confirm !== null"
    title="Take over a running run?"
    :text="takeOver.confirm?.text ?? ''"
    yes-label="Stop and take over"
    no-label="Cancel"
    :run="takeOver.confirmYes"
    @close="takeOver.cancel"
  />
</template>
