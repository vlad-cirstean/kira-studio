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
import { Input } from '@theme/components/ui/input';
import { computed, ref, watch } from 'vue';
import { useAdeUiStore } from './state/adeUi';

// P129 Part 5 §0.11: one shared yes/no prompt across every caller this phase needs (the day-off
// move confirm, §0.16's protected-branch force-push confirm) — the workbench's own `ConfirmDialog`
// has a fixed title and Cancel/Delete-or-Continue buttons, neither of which fits either caller's own
// wording. `adeUi.confirm`'s own `run` closure already knows what "yes" does; this component only
// renders it and awaits it, surfacing a rejection in-dialog rather than closing.
const adeUiStore = useAdeUiStore();
const confirm = computed(() => adeUiStore.confirm);

const typed = ref('');
const busy = ref(false);

// A fresh confirm always starts from an empty token input, even if the previous one was left
// half-typed.
watch(confirm, (c) => {
  if (c) typed.value = '';
});

const yesDisabled = computed(() => {
  const c = confirm.value;
  if (!c || busy.value) return true;
  return c.token !== null && typed.value !== c.token;
});

function onCancel(): void {
  adeUiStore.closeConfirm();
}

async function onYes(): Promise<void> {
  const c = confirm.value;
  if (!c) return;
  busy.value = true;
  try {
    await c.run();
    adeUiStore.closeConfirm();
  } catch (err) {
    adeUiStore.setConfirmError(err instanceof Error ? err.message : String(err));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-if="confirm" :open="true" @update:open="(v) => !v && onCancel()">
    <DialogContent :show-close-button="false" data-testid="ade-confirm-dialog" class="w-100">
      <DialogHeader>
        <DialogTitle>{{ confirm.title }}</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-2 px-3 py-2 text-kira-md">
        <p>{{ confirm.text }}</p>
        <Alert v-if="confirm.error" variant="destructive" data-testid="ade-confirm-error">
          <AlertDescription>{{ confirm.error }}</AlertDescription>
        </Alert>
        <Input
          v-if="confirm.token !== null"
          :model-value="typed"
          :placeholder="confirm.token"
          data-testid="ade-confirm-token"
          @update:model-value="(v) => (typed = String(v))"
        />
      </div>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="ade-confirm-no" @click="onCancel">
          {{ confirm.noLabel }}
        </Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :disabled="yesDisabled"
          data-testid="ade-confirm-yes"
          @click="onYes"
        >
          {{ confirm.yesLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
