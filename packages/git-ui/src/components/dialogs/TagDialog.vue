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
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
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
const forceId = useId();
const annotatedId = useId();
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
      :aria-describedby="undefined"
      size="md"
    >
      <DialogHeader closable>
        <DialogTitle>Create tag</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <FieldDescription>Tagging <code class="font-data">{{ target.slice(0, 7) }}</code></FieldDescription>

        <Field>
          <FieldLabel :for="nameId">Name</FieldLabel>
          <Input :id="nameId" v-model="name" type="text" size="kira-lg" class="w-full" />
          <FieldError v-if="state.nameError">{{ state.nameError }}</FieldError>
        </Field>

        <template v-if="state.verdict === 'blockedByExisting'">
          <Alert variant="warn">
            <AlertDescription>
              A tag named "{{ name }}" already exists{{ state.existingIsAnnotated ? ' (annotated)' : '' }}.
            </AlertDescription>
          </Alert>
          <Field orientation="horizontal">
            <Checkbox :id="forceId" v-model="force" />
            <FieldLabel :for="forceId">Replace it</FieldLabel>
          </Field>
        </template>

        <Alert v-if="state.verdict === 'movesWithForce' && state.requiresAnnotationToPreserve" variant="warn">
          <AlertDescription>
            The existing tag is annotated — moving it without a message here would silently downgrade
            it to lightweight. Supply a message below to keep it annotated.
          </AlertDescription>
        </Alert>

        <Field orientation="horizontal">
          <Checkbox :id="annotatedId" v-model="annotated" />
          <FieldLabel :for="annotatedId">Annotated</FieldLabel>
        </Field>
        <Field v-if="annotated">
          <FieldLabel :for="messageId">Message</FieldLabel>
          <Textarea :id="messageId" v-model="message" rows="3" class="w-full" />
        </Field>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" @click="cancel">Cancel</Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" @click="submit">
          Create tag
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
