<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';

// Every phone action that moves or starts work asks first: a mis-tap on a phone is common and
// these act on running agents.
defineProps<{
  open: boolean;
  title: string;
  text: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('cancel')">
    <DialogContent size="sm" data-testid="confirm-dialog">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ text }}</DialogDescription>
      </DialogHeader>
      <DialogBody v-if="error">
        <Alert variant="destructive" data-testid="confirm-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </DialogBody>
      <DialogFooter>
        <Button size="kira" variant="dialog" class="h-11 flex-1" data-testid="confirm-cancel" @click="emit('cancel')">
          Cancel
        </Button>
        <Button size="kira"
          variant="dialog-primary"
          class="h-11 flex-1"
          :disabled="busy"
          data-testid="confirm-yes"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
