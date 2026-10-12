<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { t } from '@theme/i18n';

// The one confirm look. A danger confirm opens with focus on Cancel (Enter cancels); a primary one
// opens on the confirm button. `touch` gives the phone's 44px buttons. Used by the store host
// (`ConfirmDialog.vue`), the ADE dialogs and the mobile screens; `testids` keeps each host's ids.
const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'danger' | 'primary';
    busy?: boolean;
    error?: string;
    touch?: boolean;
    testids?: Partial<
      Record<'root' | 'close' | 'message' | 'cancel' | 'confirm' | 'error', string>
    >;
  }>(),
  {
    busy: false,
    error: '',
    touch: false,
    testids: () => ({}),
  },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const ids = {
  root: 'confirm-dialog',
  close: 'confirm-dialog-close',
  message: 'confirm-dialog-message',
  cancel: 'confirm-dialog-cancel',
  confirm: 'confirm-dialog-confirm',
  error: 'confirm-dialog-error',
};
const id = (name: keyof typeof ids): string => props.testids[name] ?? ids[name];
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && !busy && emit('cancel')">
    <DialogContent size="sm" :destructive="tone === 'danger'" :data-testid="id('root')">
      <DialogHeader :close-testid="id('close')">
        <DialogTitle class="break-all">{{ title }}</DialogTitle>
      </DialogHeader>

      <DialogBody>
        <p v-if="message" class="m-0 whitespace-pre-wrap" :data-testid="id('message')">{{
          message
        }}</p>
        <Alert v-if="error" variant="error" :data-testid="id('error')">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </DialogBody>

      <DialogFooter>
        <Button
          variant="dialog"
          :size="touch ? 'touch' : 'kira-lg'"
          data-dialog-dismiss
          :class="touch ? 'flex-1' : undefined"
          :data-testid="id('cancel')"
          @click="!busy && emit('cancel')"
        >
          {{ t('common.action.cancel.label') }}
        </Button>
        <Button
          data-dialog-initial
          :variant="tone === 'danger' ? 'dialog-danger' : 'dialog-primary'"
          :size="touch ? 'touch' : 'kira-lg'"
          :class="touch ? 'flex-1' : undefined"
          :pending="busy"
          :data-testid="id('confirm')"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
