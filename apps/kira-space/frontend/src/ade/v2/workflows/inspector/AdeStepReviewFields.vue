<script setup lang="ts">
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { t } from '@theme/i18n';
import { computed } from 'vue';
import type { ReviewStepConfig, WorkflowStep } from '../../wire';

const props = defineProps<{ step: WorkflowStep; steps: WorkflowStep[] }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
// Earlier steps whose session can take the comments: agent steps with a prompt.
const implementers = computed(() => {
  const at = props.steps.findIndex((s) => s.id === props.step.id);
  return props.steps
    .slice(0, Math.max(at, 0))
    .filter((s) => s.kind === 'agent' && s.smartScript === '');
});
function patchReview(p: Partial<ReviewStepConfig>): void {
  if (props.step.review) emit('patch', { review: { ...props.step.review, ...p } });
}
const id = (k: string): string => `ade-wf-step-${k}-${props.step.id}`;
</script>

<template>
  <div
    v-if="step.review"
    class="flex flex-col gap-2 text-kira-sm text-muted-foreground"
    data-testid="ade-wf-step-review"
  >
    <Label :for="id('review-send-to')">{{
      t('space.ade.workflows.stepInspector.reviewSendTo.label')
    }}</Label>
    <NativeSelect
      :id="id('review-send-to')"
      variant="bordered"
      :model-value="step.review.sendTo"
      data-testid="ade-wf-step-review-send-to"
      @update:model-value="(v) => patchReview({ sendTo: v === 'new' ? 'new' : 'implementer' })"
    >
      <option value="implementer">{{ t('space.ade.reviewStep.route.implementer.label') }}</option>
      <option value="new">{{ t('space.ade.reviewStep.route.new.label') }}</option>
    </NativeSelect>
    <template v-if="step.review.sendTo === 'implementer'">
      <Label :for="id('review-implementer')">{{
        t('space.ade.workflows.stepInspector.reviewImplementer.label')
      }}</Label>
      <NativeSelect
        :id="id('review-implementer')"
        variant="bordered"
        :model-value="step.review.implementer"
        data-testid="ade-wf-step-review-implementer"
        @update:model-value="(v) => patchReview({ implementer: String(v) })"
      >
        <option value="">{{ t('space.ade.workflows.stepInspector.reviewNearest.option') }}</option>
        <option v-for="s in implementers" :key="s.id" :value="s.id">{{ s.name }}</option>
      </NativeSelect>
    </template>
    <span class="text-subtle" data-testid="ade-wf-review-note">{{
      t('space.ade.workflows.stepInspector.reviewNote.hint')
    }}</span>
  </div>
</template>
