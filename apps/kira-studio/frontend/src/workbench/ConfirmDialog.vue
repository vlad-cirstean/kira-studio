<script setup lang="ts">
import { confirmDialogState, settleConfirmDialog } from '../state/confirmDialog';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';

function onCancel(): void {
  settleConfirmDialog(false);
}

function onConfirm(): void {
  settleConfirmDialog(true);
}
</script>

<template>
  <DialogFrame
    v-if="confirmDialogState.open"
    title="Confirm"
    :width="400"
    test-id="confirm-dialog"
    close-test-id="confirm-dialog-close"
    @close="onCancel"
  >
    <p class="message" data-testid="confirm-dialog-message">{{ confirmDialogState.message }}</p>

    <template #footer>
      <span class="p-dialog-actions end footer-actions p-push">
        <AppButton kind="dialog" data-testid="confirm-dialog-cancel" @click="onCancel">
          Cancel
        </AppButton>
        <AppButton
          kind="dialog"
          :variant="confirmDialogState.danger ? 'danger' : 'primary'"
          data-testid="confirm-dialog-confirm"
          @click="onConfirm"
        >
          {{ confirmDialogState.danger ? 'Delete' : 'Continue' }}
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.message {
  margin: 0;
  padding: var(--kira-s-4) var(--kira-s-5);
  white-space: pre-wrap;
}

/* p-dialog-actions.end supplies display/align-items/justify-content/width; this dialog keeps its
   own tighter s-2 gap rather than the shared s-3. */
.footer-actions {
  gap: var(--kira-s-2);
}
</style>
