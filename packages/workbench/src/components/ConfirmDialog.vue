<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
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
    <DialogContent
      :show-close-button="false"
      data-testid="confirm-dialog"
      class="w-100"
    >
      <DialogHeader>
        <DialogTitle>Confirm</DialogTitle>
      </DialogHeader>

      <p class="m-0 whitespace-pre-wrap" data-testid="confirm-dialog-message">
        {{ confirmDialogStore.message }}
      </p>

      <!-- P110 I2-21: DialogFooter's own base changed (§3.10, M9) -- this explicit class restates
           the old merged default so this dialog's look stays put. -->
      <DialogFooter
        class="items-stretch gap-2 border-t bg-muted/50 -mx-4 -mb-4 rounded-b-xl p-4 flex-col-reverse sm:flex-row sm:justify-end"
      >
        <Button variant="dialog" size="kira-lg" data-testid="confirm-dialog-cancel" @click="onCancel">
          Cancel
        </Button>
        <Button
          :variant="confirmDialogStore.danger ? 'dialog-danger' : 'dialog-primary'"
          size="kira-lg"
          data-testid="confirm-dialog-confirm"
          @click="onConfirm"
        >
          {{ confirmDialogStore.danger ? 'Delete' : 'Continue' }}
        </Button>
      </DialogFooter>

      <DialogClose as-child>
        <Button
          variant="ghost"
          size="icon-sm"
          class="absolute top-2 right-2"
          aria-label="Close"
          data-testid="confirm-dialog-close"
        >
          <CodiconIcon name="close" :size="13" />
        </Button>
      </DialogClose>
    </DialogContent>
  </Dialog>
</template>
