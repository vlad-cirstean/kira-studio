<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { useConfirmDialogStore } from '../state/confirmDialog';

const confirmDialogStore = useConfirmDialogStore();

function onCancel(): void {
  confirmDialogStore.settleConfirmDialog(false);
}

function onConfirm(): void {
  confirmDialogStore.settleConfirmDialog(true);
}
</script>

<template>
  <!-- v-if, not just :open — reka's DialogPortal inserts each open dialog's node at the *end* of
       body at open time, so DOM (and paint) order tracks open order. Bound only by :open, this
       component's Teleport target would instead claim a fixed, early DOM position from app boot
       (ConfirmDialog is always mounted, unlike whatever dialog it confirms over), permanently
       under any dialog opened later — exactly the DbMcpApprovalDialog.vue precedent this mirrors.
       Losing the closing fade (v-if unmounts immediately, no exit transition) is the accepted
       trade-off for correct stacking when nested under another open dialog. -->
  <Dialog v-if="confirmDialogStore.open" :open="true" @update:open="(v) => !v && onCancel()">
    <DialogContent size="sm" data-testid="confirm-dialog">
      <DialogHeader closable close-testid="confirm-dialog-close">
        <DialogTitle>Confirm</DialogTitle>
      </DialogHeader>

      <DialogBody>
        <p class="m-0 whitespace-pre-wrap" data-testid="confirm-dialog-message">
          {{ confirmDialogStore.message }}
        </p>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="confirm-dialog-cancel" @click="onCancel">
          Cancel
        </Button>
        <Button
          :variant="confirmDialogStore.danger ? 'dialog-danger' : 'dialog-primary'"
          size="kira-lg"
          data-testid="confirm-dialog-confirm"
          @click="onConfirm"
        >
          {{ confirmDialogStore.confirmLabel || (confirmDialogStore.danger ? 'Delete' : 'Continue') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
