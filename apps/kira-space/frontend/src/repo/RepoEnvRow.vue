<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { useFocusOnMount } from '@workbench/behaviour/focus';
import { useInlineEdit } from '@workbench/behaviour/inlineEdit';
import { type ComponentPublicInstance, useTemplateRef } from 'vue';
import type { Environment } from '../ade/v2/wire';

// One environment of a repo: its name and the script that prints the deployed SHA.
const props = defineProps<{
  env: Environment;
  index: number;
  pending?: boolean;
  focusOnMount?: boolean;
  save: (env: Environment) => Promise<void>;
}>();
const nameInput = useTemplateRef<ComponentPublicInstance>('nameInput');
if (props.focusOnMount) useFocusOnMount(nameInput);
const emit = defineEmits<{ remove: [] }>();

const name = useInlineEdit({
  source: () => props.env.name,
  commit: (v) => props.save({ ...props.env, name: v }),
  allowEmpty: true,
});
const script = useInlineEdit({
  source: () => props.env.deployedShaScript,
  commit: (v) => props.save({ ...props.env, deployedShaScript: v }),
  allowEmpty: true,
});
</script>

<template>
  <div class="flex flex-col gap-1" data-testid="repo-env">
    <div class="flex items-center gap-1.5">
      <Label :for="`repo-env-name-${index}`" class="sr-only">{{
        t('common.environmentName.aria')
      }}</Label>
      <Input
        :id="`repo-env-name-${index}`"
        ref="nameInput"
        :placeholder="t('space.repo.env.name.example')"
        :model-value="name.text.value"
        class="w-32 shrink-0 font-data font-medium"
        data-testid="repo-env-name"
        @update:model-value="name.onInput"
        @blur="name.onCommit"
        @keydown="name.onKeydown"
      />
      <Label :for="`repo-env-script-${index}`" class="sr-only">{{
        t('space.repo.env.script.aria')
      }}</Label>
      <Input
        :id="`repo-env-script-${index}`"
        :model-value="script.text.value"
        :placeholder="t('space.repo.env.script.example')"
        class="min-w-0 flex-1 font-data"
        data-testid="repo-env-script"
        @update:model-value="script.onInput"
        @blur="script.onCommit"
        @keydown="script.onKeydown"
      />
      <TooltipIconButton
        icon="close"
        :label="t('space.repo.env.remove.tooltip')"
        :pending="pending"
        data-testid="repo-env-remove"
        @click="emit('remove')"
      />
    </div>
    <FieldError v-if="name.error.value || script.error.value" data-testid="repo-env-error">{{
      name.error.value || script.error.value
    }}</FieldError>
  </div>
</template>
