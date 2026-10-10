<script setup lang="ts">
/**
 * `docs/plans/P7.md` W14: "Rename branch…" from the graph's own ref-badge context menu
 * (`App.vue`'s second `RowContextMenu`). `BranchPicker.vue`'s own rename swaps its dropdown row
 * for an inline text field — there is no comparable row here (the badge is a DOM fragment inside
 * a commit's message cell, not a list item with room to become an input), so this is a small
 * modal instead: `BranchDialog.vue`'s own "no comparable hazard" judgment call (git never
 * refuses a rename the way it can refuse a checkout or a force-move), extended to a rename with
 * a prefilled name field rather than an empty one, validated with the same `validateRefName`
 * prefilter `BranchDialog.vue`/`TagDialog.vue` already use.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */
import { validateRefName } from '@kira/git-core';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { computed, ref, useId, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ open: boolean; currentName: string; ops: OpsState }>();
const emit = defineEmits<(e: 'close') => void>();

const name = ref('');
const nameId = useId();

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = props.currentName;
  },
);

const nameError = computed(() => {
  if (name.value === '' || name.value === props.currentName) return undefined;
  const { valid, error } = validateRefName(name.value);
  return valid ? undefined : error;
});
const canSubmit = computed(
  () => name.value !== '' && name.value !== props.currentName && nameError.value === undefined,
);

function cancel(): void {
  emit('close');
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const result = await props.ops.branchRename(props.currentName, name.value);
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
        <DialogTitle>Rename branch</DialogTitle>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div class="flex min-h-0 flex-col gap-3 overflow-auto p-3">
        <FieldDescription>Renaming <code class="font-data">{{ currentName }}</code></FieldDescription>

        <Field>
          <FieldLabel :for="nameId">New name</FieldLabel>
          <Input :id="nameId" v-model="name" type="text" size="kira-lg" class="w-full" />
          <FieldError v-if="nameError">{{ nameError }}</FieldError>
        </Field>
      </div>

      <DialogFooter class="justify-end">
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" @click="submit">
          Rename branch
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
