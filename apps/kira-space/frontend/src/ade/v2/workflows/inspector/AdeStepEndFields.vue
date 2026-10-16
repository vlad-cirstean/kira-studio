<script setup lang="ts">
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import { MAX_RETURNS } from '../../board/stepResults';
import type { WorkflowStep } from '../../wire';
import AdeStepResults from './AdeStepResults.vue';

const props = defineProps<{ step: WorkflowStep; steps: WorkflowStep[] }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
const minReturns = computed(() => (props.step.kind === 'review' ? 0 : 1));
function onReturns(v: string | number): void {
  const n = Math.trunc(Number(v));
  if (Number.isNaN(n)) return;
  emit('patch', { maxReturns: Math.min(MAX_RETURNS, Math.max(minReturns.value, n)) });
}
const id = `ade-wf-step-max-returns-${props.step.id}`;
</script>

<template>
  <AdeStepResults :step="step" :steps="steps" :fixed="step.kind === 'script'" />
  <div class="flex flex-wrap items-center gap-2 text-kira-sm text-muted-foreground">
    <Label :for="id">{{ t('space.ade.workflows.stepInspector.maxReturns.label') }}</Label>
    <Input
      :id="id"
      type="number"
      :min="minReturns"
      :max="MAX_RETURNS"
      :model-value="step.maxReturns"
      size="kira"
      class="w-14"
      data-testid="ade-wf-step-max-returns"
      @update:model-value="onReturns"
    />
    <span class="text-subtle" data-testid="ade-wf-step-max-returns-hint">{{
      t('space.ade.workflows.stepInspector.maxReturns.hint')
    }}</span>
  </div>
</template>
