<script setup lang="ts">
/**
 * "Create branch here" (W14's row menu). §10's own exit table and W15's own text enumerate only
 * `CheckoutDialog`/`TagDialog`/`RevertDialog` — branch creation has no comparable hazard (git
 * never refuses it, and there is no annotated-tag-style silent-data-loss case to guard), so this
 * file is a judgment call rather than something the plan named directly: the same small
 * name/start-point/checkout-toggle modal `TagDialog.vue` uses for a tag, reusing `core`'s own
 * `validateRefName` prefilter (branch and tag names share the same `check-ref-format --branch`
 * rule, §7.5/§7.9 both cite it).
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */
import { validateRefName } from '@kira/git-core';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ open: boolean; startPoint: string; ops: OpsState }>();
const emit = defineEmits<(e: 'close') => void>();

const name = ref('');
const checkout = ref(true);
const nameId = useId();
const checkoutId = useId();

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = '';
    checkout.value = true;
  },
);

const nameError = computed(() => {
  if (name.value === '') return undefined;
  const { valid, error } = validateRefName(name.value);
  return valid ? undefined : error;
});
const canSubmit = computed(() => name.value !== '' && nameError.value === undefined);

function cancel(): void {
  emit('close');
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const result = await props.ops.branchCreate({
    name: name.value,
    startPoint: props.startPoint,
    checkout: checkout.value,
    track: undefined,
  });
  if (!result.ok) return;
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && cancel()">
    <DialogContent
      :show-close-button="false"
      :aria-describedby="undefined"
      class="flex flex-col p-0 gap-0 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Create branch</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <FieldDescription>Starting from <code class="font-data">{{ startPoint.slice(0, 7) }}</code></FieldDescription>

        <Field>
          <FieldLabel :for="nameId">Name</FieldLabel>
          <Input :id="nameId" v-model="name" type="text" size="kira-lg" class="w-full" />
          <FieldError v-if="nameError">{{ nameError }}</FieldError>
        </Field>

        <Field orientation="horizontal">
          <Checkbox :id="checkoutId" v-model="checkout" />
          <FieldLabel :for="checkoutId">Switch to it</FieldLabel>
        </Field>
      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" @click="submit">
          Create branch
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
