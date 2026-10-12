<script setup lang="ts">
/**
 * `docs/plans/P7.md` W14: "Rename branch…" from the graph's own ref-badge context menu
 * (`App.vue`'s ref menu). `BranchPicker.vue`'s own rename swaps its dropdown row
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
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed, ref, useId, watch } from 'vue';
import { renderText } from '../../lib/text.ts';
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
  return valid || error === undefined ? undefined : renderText(error);
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
    <DialogContent :aria-describedby="undefined" size="md">
      <DialogHeader>
        <DialogTitle>{{ t('git.dialog.rename.title') }}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FieldDescription>
          <CatalogText k="git.dialog.rename.description">
            <template #name><code class="font-data">{{ currentName }}</code></template>
          </CatalogText>
        </FieldDescription>

        <Field>
          <FieldLabel :for="nameId">{{ t('git.dialog.rename.name.label') }}</FieldLabel>
          <Input :id="nameId" v-model="name" type="text" size="kira-lg" class="w-full" />
          <FieldError v-if="nameError">{{ nameError }}</FieldError>
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" @click="cancel">{{
          t('common.action.cancel.label')
        }}</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" @click="submit">
          {{ t('common.action.rename.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
