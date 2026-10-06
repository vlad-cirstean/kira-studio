<script setup lang="ts">
/**
 * `docs/plans/P6.md` W15: "create tag here" (W14's row menu). Unlike `CheckoutDialog.vue`/
 * `RevertDialog.vue`, this one is not driven by an `OpsState` pending-ref (P6 has no
 * `preflight.tagCreate` endpoint) — `App.vue` opens it directly with the target sha and closes
 * it on `close`; `tagDialogModel.ts` supplies the pure classification either way.
 *
 * P131 Part 1 §6.1: the modal shell is shadcn's `Dialog`/`DialogContent` now — this file still
 * only supplies its own body/footer content.
 */

import type { RefRow } from '@kira/git-ipc';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, useId, watch } from 'vue';
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
const nameId = useId();
const messageId = useId();

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
  const result = await props.ops.tagCreate({
    name: name.value,
    target: props.target,
    message: annotated.value ? message.value : undefined,
    force: force.value,
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
      class="flex flex-col gap-0 p-3 w-120 max-w-[90vw] max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Create tag</DialogTitle>
      </DialogHeader>
      <div class="min-h-0 overflow-y-auto">
        <p class="kv:text-diff-deleted">Tagging <code>{{ target.slice(0, 7) }}</code></p>

        <label :for="nameId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
          Name
          <Input :id="nameId" v-model="name" type="text" size="kira" class="w-full" />
        </label>
        <p v-if="state.nameError" class="kv:text-diff-deleted kv:my-0.5">{{ state.nameError }}</p>

        <template v-if="state.verdict === 'blockedByExisting'">
          <p class="kv:text-diff-deleted kv:my-0.5">
            A tag named "{{ name }}" already exists{{ state.existingIsAnnotated ? ' (annotated)' : '' }}.
          </p>
          <Label class="flex flex-row items-center gap-1 my-1">
            <Checkbox v-model="force" />
            Replace it
          </Label>
        </template>

        <template v-if="state.verdict === 'movesWithForce' && state.requiresAnnotationToPreserve">
          <p class="kv:text-diff-deleted kv:my-0.5">
            The existing tag is annotated — moving it without a message here would silently downgrade
            it to lightweight. Supply a message below to keep it annotated.
          </p>
        </template>

        <Label class="flex flex-row items-center gap-1 my-1">
          <Checkbox v-model="annotated" />
          Annotated
        </Label>
        <label v-if="annotated" :for="messageId" class="kv:flex kv:flex-col kv:gap-0.5 kv:my-1">
          Message
          <Textarea :id="messageId" v-model="message" rows="3" class="w-full" />
        </label>
      </div>

      <DialogFooter class="justify-end gap-1">
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" @click="submit">
          Create tag
        </Button>
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
