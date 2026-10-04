<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { ref, watch } from 'vue';

// One yes/no prompt. `run` resolves with an error message to keep the dialog open and show it, or
// `null` on success, which closes it.
const props = defineProps<{
  open: boolean;
  title: string;
  text: string;
  yesLabel: string;
  noLabel: string;
  run: () => Promise<string | null>;
}>();
const emit = defineEmits<{ close: [] }>();

const busy = ref(false);
const error = ref('');
watch(
  () => props.open,
  (o) => {
    if (o) error.value = '';
  },
);

async function onYes(): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const msg = await props.run();
    if (msg === null) emit('close');
    else error.value = msg;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent :show-close-button="false" data-testid="ade-confirm-dialog" class="w-110">
      <DialogHeader>
        <DialogTitle class="break-all">{{ title }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-2 px-3 py-2 text-kira-md">
        <p v-if="text">{{ text }}</p>
        <Alert v-if="error" variant="destructive" data-testid="ade-confirm-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="ade-confirm-no" @click="emit('close')">
          {{ noLabel }}
        </Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="busy"
          data-testid="ade-confirm-yes"
          @click="onYes"
        >
          {{ yesLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
