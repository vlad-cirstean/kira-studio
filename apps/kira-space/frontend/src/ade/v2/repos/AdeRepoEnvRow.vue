<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import type { Environment } from '../wire';
import { useCommitField } from './useCommitField';

// One environment of a repo: its name and the script that prints the deployed SHA.
const props = defineProps<{ env: Environment; index: number; busy?: boolean; save: (env: Environment) => Promise<void> }>();
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
  <div class="flex flex-col gap-1" data-testid="ade-repo-env">
    <div class="flex items-start gap-2 rounded-kira border border-border-strong bg-elevated px-2.5 py-2">
      <label :for="`ade-env-name-${index}`" class="sr-only">Environment name</label>
      <Input
        :id="`ade-env-name-${index}`"
        :model-value="name.text.value"
        class="w-[110px] shrink-0 bg-field px-2 font-data font-semibold"
        data-testid="ade-env-name"
        @update:model-value="name.onInput"
        @blur="name.onCommit"
        @keydown.enter="name.onCommit"
      />
      <label :for="`ade-env-script-${index}`" class="sr-only">Deployed SHA script</label>
      <Input
        :id="`ade-env-script-${index}`"
        :model-value="script.text.value"
        placeholder="prints the deployed SHA"
        class="min-w-0 flex-1 bg-bg px-2 font-data"
        data-testid="ade-env-script"
        @update:model-value="script.onInput"
        @blur="script.onCommit"
        @keydown.enter="script.onCommit"
      />
      <Button
        variant="dialog"
        size="icon-xs"
        class="size-7 text-error"
        aria-label="Remove environment"
        :disabled="busy"
        data-testid="ade-env-remove"
        @click="emit('remove')"
      >
        ✕
      </Button>
    </div>
    <span v-if="name.error.value || script.error.value" class="text-kira-sm text-error" data-testid="ade-env-error">{{
      name.error.value || script.error.value
    }}</span>
  </div>
</template>
