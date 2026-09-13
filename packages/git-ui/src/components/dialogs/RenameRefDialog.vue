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
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content.
 */
import { validateRefName } from '@kira/git-core';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ open: boolean; currentName: string; ops: OpsState }>();
const emit = defineEmits<(e: 'close') => void>();

const name = ref('');

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
  await props.ops.branchRename(props.currentName, name.value);
  emit('close');
}
</script>

<template>
  <KuiDialog :open="open" title="Rename branch" @close="cancel">
    <p class="kv-dialog-note">Renaming <code>{{ currentName }}</code></p>

    <label class="kv-dialog-field">
      New name
      <input type="text" v-model="name" autofocus />
    </label>
    <p v-if="nameError" class="kv-dialog-error">{{ nameError }}</p>

    <template #actions>
      <KuiButton variant="primary" :disabled="!canSubmit" @click="submit">Rename branch</KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>

<style scoped>
.kv-dialog-note {
  color: var(--kv-diff-deleted-fg);
}

.kv-dialog-field {
  display: flex;
  flex-direction: column;
  gap: var(--kv-s-1);
  margin: var(--kv-s-2) 0;
}

.kv-dialog-field input[type='text'] {
  padding: var(--kv-s-1) var(--kv-s-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-dialog-error {
  color: var(--kv-diff-deleted-fg);
  margin: var(--kv-s-1) 0;
}
</style>
