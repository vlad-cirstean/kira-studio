<script setup lang="ts">
/**
 * `docs/plans/P6.md` W15: "create tag here" (W14's row menu). Unlike `CheckoutDialog.vue`/
 * `RevertDialog.vue`, this one is not driven by an `OpsState` pending-ref (P6 has no
 * `preflight.tagCreate` endpoint) — `App.vue` opens it directly with the target sha and closes
 * it on `close`; `tagDialogModel.ts` supplies the pure classification either way.
 *
 * G21 D2: the modal shell is `@kira/kira-ui`'s `KuiDialog` now — this file only supplies its own
 * body/actions content.
 */

import type { RefRow } from '@kira/git-ipc';
import { KuiButton, KuiDialog } from '@kira/kira-ui';
import { computed, ref, watch } from 'vue';
import type { OpsState } from '../../state/ops.ts';
import { canSubmitTagCreate, classifyTagName } from './tagDialogModel.ts';

const props = defineProps<{
  open: boolean;
  target: string;
  existingTags: readonly RefRow[];
  ops: OpsState;
}>();

const emit = defineEmits<(e: 'close') => void>();

const name = ref('');
const annotated = ref(false);
const message = ref('');
const force = ref(false);

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return;
    name.value = '';
    annotated.value = false;
    message.value = '';
    force.value = false;
  },
);

const state = computed(() => classifyTagName(name.value, props.existingTags, force.value));
const canSubmit = computed(() => canSubmitTagCreate(state.value, annotated.value, message.value));

function cancel(): void {
  emit('close');
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  await props.ops.tagCreate({
    name: name.value,
    target: props.target,
    message: annotated.value ? message.value : undefined,
    force: force.value,
  });
  emit('close');
}
</script>

<template>
  <KuiDialog :open="open" title="Create tag" @close="cancel">
    <p class="kv-dialog-note">Tagging <code>{{ target.slice(0, 7) }}</code></p>

    <label class="kv-dialog-field">
      Name
      <input type="text" v-model="name" autofocus />
    </label>
    <p v-if="state.nameError" class="kv-dialog-error">{{ state.nameError }}</p>

    <template v-if="state.verdict === 'blockedByExisting'">
      <p class="kv-dialog-error">
        A tag named "{{ name }}" already exists{{ state.existingIsAnnotated ? ' (annotated)' : '' }}.
      </p>
      <label class="kv-dialog-field kv-dialog-field--inline">
        <input type="checkbox" v-model="force" />
        Replace it
      </label>
    </template>

    <template v-if="state.verdict === 'movesWithForce' && state.requiresAnnotationToPreserve">
      <p class="kv-dialog-error">
        The existing tag is annotated — moving it without a message here would silently downgrade
        it to lightweight. Supply a message below to keep it annotated.
      </p>
    </template>

    <label class="kv-dialog-field kv-dialog-field--inline">
      <input type="checkbox" v-model="annotated" />
      Annotated
    </label>
    <label v-if="annotated" class="kv-dialog-field">
      Message
      <textarea v-model="message" rows="3"></textarea>
    </label>

    <template #actions>
      <KuiButton variant="primary" :disabled="!canSubmit" @click="submit">Create tag</KuiButton>
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
  gap: var(--kv-space-1);
  margin: var(--kv-space-2) 0;
}

.kv-dialog-field--inline {
  flex-direction: row;
  align-items: center;
}

.kv-dialog-field input[type='text'],
.kv-dialog-field textarea {
  padding: var(--kv-space-1) var(--kv-space-2);
  background: var(--kv-panel-bg);
  color: var(--kv-row-fg);
  border: 1px solid var(--kv-panel-border);
  font-family: inherit;
}

.kv-dialog-error {
  color: var(--kv-diff-deleted-fg);
  margin: var(--kv-space-1) 0;
}
</style>
