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
  <Dialog :open="confirmDialogStore.open" @update:open="(v) => !v && onCancel()">
    <!-- DialogContent's own base classes cap max-width at sm:max-w-sm (384px < w-100's 400px) —
         max-w-100/sm:max-w-100 replace both the bare and the sm: rule (twMerge needs the same
         variant to dedupe a conflict). -->
    <DialogContent
      :show-close-button="false"
      data-testid="confirm-dialog"
      class="w-100 max-w-100 sm:max-w-100"
    >
      <DialogHeader>
        <DialogTitle>Confirm</DialogTitle>
      </DialogHeader>

      <p class="m-0 whitespace-pre-wrap" data-testid="confirm-dialog-message">
        {{ confirmDialogStore.message }}
      </p>

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
