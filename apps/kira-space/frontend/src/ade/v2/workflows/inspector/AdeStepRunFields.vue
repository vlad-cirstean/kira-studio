<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { t } from '@theme/i18n';
import { runsOnLabel } from '../../board/workflowForm';
import type { WorkflowStep } from '../../wire';

const props = defineProps<{ step: WorkflowStep; scopes: string[] }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
const id = `ade-wf-step-scope-${props.step.id}`;
const gates = [
  {
    value: 'auto',
    label: t('space.ade.workflows.gate.auto.option'),
    testid: 'ade-wf-step-gate-auto',
  },
  {
    value: 'approval',
    label: t('space.ade.workflows.gate.approval.option'),
    testid: 'ade-wf-step-gate-approval',
  },
];
</script>

<template>
  <div class="flex flex-col gap-1">
    <Label :for="id" class="text-kira-sm text-muted-foreground">{{
      t('space.ade.workflows.field.runsOn.label')
    }}</Label>
    <NativeSelect
      :id="id"
      variant="bordered"
      :model-value="step.runsOn"
      data-testid="ade-wf-step-scope"
      @update:model-value="(v) => emit('patch', { runsOn: String(v) as WorkflowStep['runsOn'] })"
    >
      <option v-for="s in scopes" :key="s" :value="s">{{ runsOnLabel(s) }}</option>
    </NativeSelect>
  </div>
  <div class="flex flex-col gap-1">
    <span class="text-kira-sm text-muted-foreground">{{ t('common.action.start.label') }}</span>
    <SecondaryTabs
      :model-value="step.before || 'auto'"
      :items="gates"
      data-testid="ade-wf-step-gate"
      @update:model-value="(v) => emit('patch', { before: v === 'approval' ? 'approval' : 'auto' })"
    />
  </div>
</template>
