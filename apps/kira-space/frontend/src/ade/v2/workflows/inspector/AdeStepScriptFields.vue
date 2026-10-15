<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { PLACEHOLDER_TOKENS } from '../../board/workflowForm';
import type { WorkflowStep } from '../../wire';

const props = defineProps<{ step: WorkflowStep }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
const id = `ade-wf-step-command-${props.step.id}`;
</script>

<template>
  <div class="flex flex-col gap-1">
    <Label :for="id" class="text-kira-sm text-muted-foreground">{{
      t('common.field.command.label')
    }}</Label>
    <Input
      :id="id"
      :model-value="step.command"
      :placeholder="t('space.ade.workflows.stepInspector.command.example')"
      size="kira"
      class="font-data"
      data-testid="ade-wf-step-command"
      @update:model-value="(v: string | number) => emit('patch', { command: String(v) })"
    />
    <span class="text-kira-sm text-subtle">{{
      t('space.ade.workflows.stepInspector.command.hint', { tokens: PLACEHOLDER_TOKENS })
    }}</span>
  </div>
</template>
