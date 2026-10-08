<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Textarea } from '@theme/components/ui/textarea';
import { ref, watch } from 'vue';
import { newIntentKey, useAdeWrites } from '../state/useAdeWrites';

// A quick reply to an agent that waits in its Claude Code session: the text is pasted into the
// terminal and submitted, without taking the terminal over.
const props = defineProps<{ open: boolean; sessionId: string; context: string }>();
const emit = defineEmits<{ close: [] }>();

const writes = useAdeWrites();
const message = ref('');
const error = ref('');
let key = newIntentKey();

watch(
  () => props.open,
  (o) => {
    if (!o) return;
    message.value = '';
    error.value = '';
    key = newIntentKey();
  },
);

async function send(): Promise<void> {
  const text = message.value.trim();
  if (!text || writes.sendReply.isPending.value) return;
  error.value = '';
  try {
    await writes.sendReply.mutateAsync({ sessionId: props.sessionId, message: text, key });
    emit('close');
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent :show-close-button="false" data-testid="reply-sheet">
      <DialogHeader>
        <DialogTitle>Reply to the agent</DialogTitle>
        <DialogDescription>{{ context }}</DialogDescription>
      </DialogHeader>
      <Textarea
        :model-value="message"
        rows="4"
        class="text-base"
        data-testid="reply-input"
        @update:model-value="(v) => (message = String(v))"
      />
      <Alert v-if="error" variant="destructive" data-testid="reply-error">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
      <DialogFooter>
        <Button variant="dialog" class="h-11 flex-1" data-testid="reply-cancel" @click="emit('close')">Cancel</Button>
        <Button
          variant="dialog-primary"
          class="h-11 flex-1"
          :disabled="!message.trim() || writes.sendReply.isPending.value"
          data-testid="reply-send"
          @click="send"
        >
          Send
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
