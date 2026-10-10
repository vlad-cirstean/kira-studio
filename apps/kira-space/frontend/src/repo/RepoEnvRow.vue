<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { onMounted, useTemplateRef } from 'vue';
import type { Environment } from '../ade/v2/wire';
import { useCommitField } from './useCommitField';

// One environment of a repo: its name and the script that prints the deployed SHA.
const props = defineProps<{
  env: Environment;
  index: number;
  busy?: boolean;
  focusOnMount?: boolean;
  save: (env: Environment) => Promise<void>;
}>();
const nameInput = useTemplateRef<{ $el: HTMLInputElement }>('nameInput');
onMounted(() => {
  if (props.focusOnMount) nameInput.value?.$el.focus();
});
const emit = defineEmits<{ remove: [] }>();

const name = useCommitField(
  () => props.env.name,
  (v) => props.save({ ...props.env, name: v }),
);
const script = useCommitField(
  () => props.env.deployedShaScript,
  (v) => props.save({ ...props.env, deployedShaScript: v }),
);
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="repo-env">
    <div class="flex items-center gap-1.5">
      <Label :for="`repo-env-name-${index}`" class="sr-only">Environment name</Label>
      <Input
        :id="`repo-env-name-${index}`"
        ref="nameInput"
        placeholder="staging"
        :model-value="name.text.value"
        class="w-32 shrink-0 font-data font-medium"
        data-testid="repo-env-name"
        @update:model-value="name.onInput"
        @blur="name.onCommit"
        @keydown.enter="name.onCommit"
      />
      <Label :for="`repo-env-script-${index}`" class="sr-only">Deployed SHA script</Label>
      <Input
        :id="`repo-env-script-${index}`"
        :model-value="script.text.value"
        placeholder="curl -s https://…/version"
        class="min-w-0 flex-1 font-data"
        data-testid="repo-env-script"
        @update:model-value="script.onInput"
        @blur="script.onCommit"
        @keydown.enter="script.onCommit"
      />
      <TooltipIconButton
        icon="close"
        label="Remove environment"
        :disabled="busy"
        data-testid="repo-env-remove"
        @click="emit('remove')"
      />
    </div>
    <FieldError v-if="name.error.value || script.error.value" data-testid="repo-env-error">{{
      name.error.value || script.error.value
    }}</FieldError>
  </div>
</template>
