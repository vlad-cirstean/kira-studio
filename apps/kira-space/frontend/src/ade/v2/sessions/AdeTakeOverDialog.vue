<script setup lang="ts">
import ConfirmDialogView from '@workbench/components/ConfirmDialogView.vue';
import { useAdeTakeOverStore } from '../state/adeTakeOver';
import { useConfirmRun } from '../useConfirmRun';

const takeOver = useAdeTakeOverStore();
const { busy, error, confirm } = useConfirmRun(
  () => takeOver.confirm !== null,
  takeOver.confirmYes,
  () => takeOver.cancel(),
);
</script>

<template>
  <ConfirmDialogView
    :open="takeOver.confirm !== null"
    title="Take over a running run?"
    :message="takeOver.confirm?.text ?? ''"
    confirm-label="Stop and take over"
    tone="danger"
    :busy="busy"
    :error="error ?? ''"
    :testids="{ root: 'ade-confirm-dialog', cancel: 'ade-confirm-no', confirm: 'ade-confirm-yes', error: 'ade-confirm-error' }"
    @confirm="confirm"
    @cancel="takeOver.cancel"
  />
</template>
