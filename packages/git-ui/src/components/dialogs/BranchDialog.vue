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
 * G21 D2: the modal shell (backdrop, focus trap, Escape-to-close) is `@kira/kira-ui`'s
 * `KuiDialog` now — this file only supplies its own body/actions content.
 */
import { validateRefName } from '@kira/git-core';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';

const props = defineProps<{ open: boolean; startPoint: string; ops: OpsState }>();
const emit = defineEmits<(e: 'close') => void>();

const name = ref('');
const checkout = ref(true);

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
  await props.ops.branchCreate({
    name: name.value,
    startPoint: props.startPoint,
    checkout: checkout.value,
    track: undefined,
  });
  emit('close');
}
</script>

<template>
  <KuiDialog :open="open" title="Create branch" @close="cancel">
    <p class="kv:text-diff-deleted">Starting from <code>{{ startPoint.slice(0, 7) }}</code></p>

    <label class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
      Name
      <input
        type="text"
        v-model="name"
        class="kv:px-1 kv:py-0.5 kv:bg-panel kv:text-row-fg kv:border kv:border-panel-border kv:font-inherit"
      />
    </label>
    <p v-if="nameError" class="kv:text-diff-deleted kv:my-0.5">{{ nameError }}</p>

    <label class="kv:flex kv:flex-row kv:items-center kv:gap-0.5 kv:my-1">
      <input type="checkbox" v-model="checkout" />
      Switch to it
    </label>

    <template #actions>
      <KuiButton variant="primary" :disabled="!canSubmit" @click="submit">Create branch</KuiButton>
      <KuiButton @click="cancel">Cancel</KuiButton>
    </template>
  </KuiDialog>
</template>
