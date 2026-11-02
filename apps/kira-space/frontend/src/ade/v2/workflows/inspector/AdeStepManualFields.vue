<script setup lang="ts">
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { t } from '@theme/i18n';
import type { WorkflowStep } from '../../wire';

const props = defineProps<{ step: WorkflowStep }>();
const emit = defineEmits<{ patch: [p: Partial<WorkflowStep>] }>();
const id = (k: string): string => `ade-wf-step-${k}-${props.step.id}`;
</script>

<template>
  <span class="text-kira-sm text-subtle" data-testid="ade-wf-manual-note">{{
    t('space.ade.workflows.stepInspector.manualNote.hint')
  }}</span>
  <div class="flex items-center gap-2">
    <Checkbox
      :id="id('session')"
      :model-value="step.session"
      data-testid="ade-wf-step-session"
      @update:model-value="
        (v) =>
          emit('patch', {
            session: v === true,
            prompt: v === true ? step.prompt : '',
            settings: v === true ? step.settings : {},
          })
      "
    />
    <Label :for="id('session')" class="text-kira-sm">{{
      t('space.ade.workflows.stepInspector.session.label')
    }}</Label>
  </div>
  <template v-if="step.session">
    <Label :for="id('session-prompt')" class="sr-only">{{
      t('space.ade.workflows.stepInspector.prompt.aria')
    }}</Label>
    <Textarea
      :id="id('session-prompt')"
      :model-value="step.prompt"
      :placeholder="t('space.ade.workflows.stepInspector.prompt.placeholder')"
      class="min-h-20 w-auto resize-y leading-normal"
      data-testid="ade-wf-step-session-prompt"
      @update:model-value="(v: string | number) => emit('patch', { prompt: String(v) })"
    />
  </template>
</template>
