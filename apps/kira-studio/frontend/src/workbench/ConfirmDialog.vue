<script setup lang="ts">
import { useConfirmDialogStore } from '../state/confirmDialog';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

const confirmDialogStore = useConfirmDialogStore();

function onCancel(): void {
  confirmDialogStore.settleConfirmDialog(false);
}

function onConfirm(): void {
  confirmDialogStore.settleConfirmDialog(true);
}
</script>

<template>
  <DialogFrame
    v-if="confirmDialogStore.open"
    title="Confirm"
    :width="400"
    test-id="confirm-dialog"
    close-test-id="confirm-dialog-close"
    @close="onCancel"
  >
    <p
      class="m-0 whitespace-pre-wrap"
      style="padding: var(--kira-s-4) var(--kira-s-5)"
      data-testid="confirm-dialog-message"
    >
      {{ confirmDialogStore.message }}
    </p>

    <template #footer>
      <!-- p-dialog-actions.end supplies display/align-items/justify-content/width; this dialog
           keeps its own tighter s-2 gap rather than the shared s-3. -->
      <span class="p-dialog-actions end p-push" style="gap: var(--kira-s-2)">
        <AppButton kind="dialog" data-testid="confirm-dialog-cancel" @click="onCancel">
          Cancel
        </AppButton>
        <AppButton
          kind="dialog"
          :variant="confirmDialogStore.danger ? 'danger' : 'primary'"
          data-testid="confirm-dialog-confirm"
          @click="onConfirm"
        >
          {{ confirmDialogStore.danger ? 'Delete' : 'Continue' }}
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>
