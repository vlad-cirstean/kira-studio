<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Card } from '@theme/components/ui/card';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { computed } from 'vue';
import { finishVars, previewTextParts } from '../board/runMessage';
import { hasContent, kindLabel, STEP_KINDS, withKind } from '../board/workflowForm';
import { useAdePromptPreview } from '../queries';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { StepKind, WorkflowStep } from '../wire';
import AdeInspectorSection from './inspector/AdeInspectorSection.vue';
import AdeStepAdvanced from './inspector/AdeStepAdvanced.vue';
import AdeStepAgentFields from './inspector/AdeStepAgentFields.vue';
import AdeStepEndFields from './inspector/AdeStepEndFields.vue';
import AdeStepManualFields from './inspector/AdeStepManualFields.vue';
import AdeStepReviewFields from './inspector/AdeStepReviewFields.vue';
import AdeStepRunFields from './inspector/AdeStepRunFields.vue';
import AdeStepScriptFields from './inspector/AdeStepScriptFields.vue';

// The selected step: kind and name on top, then what it does, where and when it runs, how it ends.
const props = defineProps<{ step: WorkflowStep; steps: WorkflowStep[]; scopes: string[] }>();
const draft = useAdeWorkflowDraftStore();
const confirm = useConfirmDialogStore();
const patch = (p: Partial<WorkflowStep>): void => draft.patchStep(props.step.id, p);

const kindItems = computed(() =>
  STEP_KINDS.map((k) => ({ value: k, label: kindLabel(k), testid: `ade-wf-step-kind-${k}` })),
);
const CLEARED = {
  prompt: 'common.prompt.label',
  command: 'common.field.command.label',
  sessionPrompt: 'space.ade.workflows.stepInspector.prompt.aria',
  smartScript: 'common.smartScript.label',
} as const;
async function setKind(v: string): Promise<void> {
  const kind = v as StepKind;
  if (kind === props.step.kind) return;
  const lost = hasContent(props.step);
  if (lost) {
    const ok = await confirm.confirm({
      title: t('space.ade.workflows.stepInspector.kindChange.title'),
      message: t('space.ade.workflows.stepInspector.kindChange.body', {
        field: t(CLEARED[lost as keyof typeof CLEARED]).toLowerCase(),
      }),
      confirmLabel: t('space.ade.workflows.stepInspector.kindChange.title'),
      tone: 'danger',
    });
    if (!ok) return;
  }
  draft.replaceStep(withKind(props.step, kind));
}

const finishPreview = useAdePromptPreview('headless.finishStep.suffix', () =>
  finishVars(props.step.results),
);
const finish = computed(() => previewTextParts(finishPreview.data.value?.parts ?? []));
const id = (k: string): string => `ade-wf-step-${k}-${props.step.id}`;
</script>

<template>
  <div
    class="flex flex-col gap-3"
    data-testid="ade-wf-step"
    :data-step-id="step.id"
    :data-kind="step.kind"
  >
    <SecondaryTabs
      :model-value="step.kind"
      :items="kindItems"
      data-testid="ade-wf-step-kind"
      @update:model-value="setKind"
    />
    <Label :for="id('name')" class="sr-only">{{
      t('space.ade.workflows.stepInspector.name.aria')
    }}</Label>
    <Input
      :id="id('name')"
      :model-value="step.name"
      size="kira"
      class="min-w-0 font-medium"
      data-testid="ade-wf-step-name"
      @update:model-value="(v: string | number) => patch({ name: String(v) })"
    />

    <AdeInspectorSection name="what" :title="t('space.ade.workflows.stepInspector.what.title')">
      <AdeStepAgentFields v-if="step.kind === 'agent'" :step="step" @patch="patch" />
      <template v-else-if="step.kind === 'script'">
        <AdeStepScriptFields :step="step" @patch="patch" />
        <span class="text-kira-sm text-subtle" data-testid="ade-wf-script-note">{{
          t('space.ade.workflows.stepInspector.scriptNote.hint')
        }}</span>
      </template>
      <AdeStepReviewFields
        v-else-if="step.kind === 'review'"
        :step="step"
        :steps="steps"
        @patch="patch"
      />
      <AdeStepManualFields v-else :step="step" @patch="patch" />
    </AdeInspectorSection>

    <AdeInspectorSection
      v-if="step.kind !== 'manual'"
      name="where"
      :title="t('space.ade.workflows.stepInspector.where.title')"
    >
      <AdeStepRunFields :step="step" :scopes="scopes" @patch="patch" />
    </AdeInspectorSection>

    <AdeInspectorSection name="end" :title="t('space.ade.workflows.stepInspector.end.title')">
      <span
        v-if="step.kind === 'manual'"
        class="text-kira-sm text-subtle"
        data-testid="ade-wf-manual-end"
        >{{
          t('space.ade.workflows.stepInspector.endManual.hint')
        }}</span
      >
      <template v-else>
        <AdeStepEndFields :step="step" :steps="steps" @patch="patch" />
        <Card
          v-if="step.kind === 'agent'"
          class="text-kira-sm text-subtle"
          data-testid="ade-wf-finish-note"
        >
          {{ t('space.ade.workflows.stepInspector.finishNote.hint') }}
          <span class="block pt-1"><VarText :parts="finish" /></span>
        </Card>
      </template>
    </AdeInspectorSection>

    <AdeInspectorSection collapsible name="advanced" :title="t('common.advanced.label')">
      <AdeStepAdvanced :step="step" @patch="patch" />
    </AdeInspectorSection>
  </div>
</template>
