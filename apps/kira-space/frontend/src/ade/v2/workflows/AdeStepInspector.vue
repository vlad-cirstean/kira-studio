<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Card } from '@theme/components/ui/card';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import ParamsForm from '@workbench/automations/run/ParamsForm.vue';
import { computed, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../../state/customScripts';
import { promptParts, smartBodyParts } from '../automation/smartStepBody';
import { finishVars, previewTextParts } from '../board/runMessage';
import {
  DEFAULT_MAX_RETURNS,
  defaultMaxReturns,
  hasImplicitResults,
  hasReviewDefaultResults,
  implicitResults,
  MAX_RETURNS,
  reviewDefaultResults,
} from '../board/stepResults';
import { formatTools, parseTools, runsOnLabel } from '../board/workflowForm';
import { useAdePromptPreview } from '../queries';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { PipelineStep } from '../wire';
import AdeStepResults from './AdeStepResults.vue';
import AdeStepSandbox from './AdeStepSandbox.vue';

const modeItems = computed(() => [
  { value: 'prompt', label: t('common.prompt.label'), testid: 'ade-wf-step-mode-prompt' },
  { value: 'smart', label: t('common.smartScript.label'), testid: 'ade-wf-step-mode-smart' },
  {
    value: 'review',
    label: t('space.ade.board.branchTag.review.label'),
    testid: 'ade-wf-step-mode-review',
  },
]);

// The selected step: name, run scope, approval gate, timeout, tools, prompt or smart script, results.
const props = defineProps<{
  stageId: string;
  step: PipelineStep;
  steps: PipelineStep[];
  scopes: string[];
}>();
const draft = useAdeWorkflowDraftStore();
const patch = (p: Partial<PipelineStep>): void => draft.patchStep(props.stageId, props.step.id, p);

const scripts = useCustomScriptsStore();
const smartScripts = computed(() => scripts.records.filter((r) => r.kind === 'smart'));
const smart = computed(() => props.step.smartScript !== '');
const script = computed(
  () => smartScripts.value.find((r) => r.name === props.step.smartScript) ?? null,
);
const mode = computed(() => (props.step.review ? 'review' : smart.value ? 'smart' : 'prompt'));
// A step sets its params by name; switching mode clears the other sides. Results change only while
// they are still the defaults of the mode left.
function setMode(v: string): void {
  if (v === mode.value) return;
  const { results } = props.step;
  const wasReview = hasReviewDefaultResults(results);
  if (v === 'review') {
    patch({
      review: { sendTo: 'implementer', implementer: '' },
      smartScript: '',
      prompt: '',
      allowedTools: [],
      params: {},
      ...(hasImplicitResults(props.step.id, results) ? { results: reviewDefaultResults() } : {}),
      ...(props.step.maxReturns === DEFAULT_MAX_RETURNS
        ? { maxReturns: defaultMaxReturns(true) }
        : {}),
    });
    return;
  }
  const restore = {
    ...(wasReview ? { results: implicitResults(props.step.id, 'stop') } : {}),
    ...(props.step.review && props.step.maxReturns === 0
      ? { maxReturns: DEFAULT_MAX_RETURNS }
      : {}),
  };
  if (v === 'smart') {
    patch({
      review: null,
      smartScript: smartScripts.value[0]?.name ?? '',
      prompt: '',
      allowedTools: [],
      params: {},
      ...restore,
    });
  } else {
    patch({ review: null, smartScript: '', params: {}, ...restore });
  }
}
// Steps before this one whose session can take the comments: prompt steps only.
const implementers = computed(() => {
  const at = props.steps.findIndex((s) => s.id === props.step.id);
  return props.steps.slice(0, Math.max(at, 0)).filter((s) => !s.review && s.smartScript === '');
});
function patchReview(p: Partial<NonNullable<PipelineStep['review']>>): void {
  if (props.step.review) patch({ review: { ...props.step.review, ...p } });
}
const bodyParts = computed(() =>
  script.value ? smartBodyParts(script.value.command, props.step.params) : [],
);
const preview = computed(() => promptParts(props.step.prompt));
const finishPreview = useAdePromptPreview('headless.finishStep.suffix', () =>
  finishVars(props.step.results),
);
const finish = computed(() => previewTextParts(finishPreview.data.value?.parts ?? []));

const toolsText = ref(formatTools(props.step.allowedTools));
watch(
  () => props.step.allowedTools,
  (tools) => {
    if (formatTools(parseTools(toolsText.value)) !== formatTools(tools))
      toolsText.value = formatTools(tools);
  },
);
function onTools(v: string | number): void {
  toolsText.value = String(v);
  patch({ allowedTools: parseTools(toolsText.value) });
}
const minReturns = computed(() => (props.step.review ? 0 : 1));
function onReturns(v: string | number): void {
  const n = Math.trunc(Number(v));
  if (Number.isNaN(n)) return;
  patch({ maxReturns: Math.min(MAX_RETURNS, Math.max(minReturns.value, n)) });
}
const id = (k: string): string => `ade-wf-step-${k}-${props.step.id}`;
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="ade-wf-step" :data-step-id="step.id">
    <div class="flex items-center gap-2">
      <Label :for="id('name')" class="sr-only">{{
        t('space.ade.workflows.stepInspector.name.aria')
      }}</Label>
      <Input
        :id="id('name')"
        :model-value="step.name"
        size="kira"
        class="min-w-0 flex-1 font-medium"
        data-testid="ade-wf-step-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
    </div>
    <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
      <Label :for="id('scope')">{{ t('space.ade.workflows.field.runsOn.label') }}</Label>
      <NativeSelect
        :id="id('scope')"
        variant="bordered"
        :model-value="step.runsOn"
        data-testid="ade-wf-step-scope"
        @update:model-value="(v) => patch({ runsOn: String(v) as PipelineStep['runsOn'] })"
      >
        <option v-for="s in scopes" :key="s" :value="s">{{ runsOnLabel(s) }}</option>
      </NativeSelect>
      <Label :for="id('gate')">{{ t('space.ade.workflows.stepInspector.before.label') }}</Label>
      <NativeSelect
        :id="id('gate')"
        variant="bordered"
        :model-value="step.before"
        data-testid="ade-wf-step-gate"
        @update:model-value="(v) => patch({ before: v === 'approval' ? 'approval' : 'auto' })"
      >
        <option value="auto">{{ t('space.ade.workflows.gate.auto.option') }}</option>
        <option value="approval">{{ t('space.ade.workflows.gate.approval.option') }}</option>
      </NativeSelect>
      <Label :for="id('timeout')">{{ t('common.field.timeout.label') }}</Label>
      <Input
        :id="id('timeout')"
        :model-value="step.timeout"
        size="kira"
        class="w-14"
        data-testid="ade-wf-step-timeout"
        @update:model-value="(v: string | number) => patch({ timeout: String(v) })"
      />
      <Label :for="id('max-returns')">{{
        t('space.ade.workflows.stepInspector.maxReturns.label')
      }}</Label>
      <Input
        :id="id('max-returns')"
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
    <SecondaryTabs
      :model-value="mode"
      :items="modeItems"
      data-testid="ade-wf-step-mode"
      @update:model-value="setMode"
    />
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
        @update:model-value="
          (v) => patchReview({ sendTo: v === 'new' ? 'new' : 'implementer' })
        "
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
          <option value="">
            {{ t('space.ade.workflows.stepInspector.reviewNearest.option') }}
          </option>
          <option v-for="s in implementers" :key="s.id" :value="s.id">{{ s.name }}</option>
        </NativeSelect>
      </template>
    </div>
    <div v-else-if="smart" class="flex flex-col gap-2" data-testid="ade-wf-step-smart">
      <Label :for="id('script')" class="text-kira-sm text-muted-foreground">{{
        t('common.smartScript.label')
      }}</Label>
      <NativeSelect
        :id="id('script')"
        variant="bordered"
        :model-value="step.smartScript"
        data-testid="ade-wf-step-script"
        @update:model-value="(v) => patch({ smartScript: String(v), params: {} })"
      >
        <option v-if="!script && step.smartScript" :value="step.smartScript">{{
          step.smartScript
        }}</option>
        <option v-for="r in smartScripts" :key="r.id" :value="r.name">✦ {{ r.name }}</option>
      </NativeSelect>
      <span
        v-if="step.smartScript && !script"
        class="text-kira-sm text-error"
        data-testid="ade-wf-step-script-missing"
      >
        {{ t('space.ade.workflows.stepInspector.scriptMissing.error') }}
      </span>
      <ParamsForm
        v-if="script && script.params.length > 0"
        :model-value="step.params"
        :params="script.params"
        @update:model-value="(v) => patch({ params: v })"
      />
      <Card
        v-if="script"
        class="font-data text-kira-sm whitespace-pre-wrap"
        data-testid="ade-wf-step-body"
      >
        <VarText :parts="bodyParts" />
      </Card>
    </div>
    <template v-else>
      <div class="flex flex-col gap-1">
        <Label :for="id('tools')" class="text-kira-sm text-muted-foreground"
          >{{ t('space.ade.workflows.stepInspector.tools.label') }}
          <span class="text-subtle">{{
            t('space.ade.workflows.stepInspector.tools.hint')
          }}</span></Label
        >
        <Input
          :id="id('tools')"
          :model-value="toolsText"
          :placeholder="t('space.ade.workflows.stepInspector.tools.example')"
          size="kira"
          class="font-data"
          data-testid="ade-wf-step-tools"
          @update:model-value="onTools"
        />
      </div>
      <Label :for="id('prompt')" class="sr-only">{{ t('common.prompt.label') }}</Label>
      <Textarea
        :id="id('prompt')"
        :model-value="step.prompt"
        :placeholder="t('common.prompt.label')"
        class="min-h-24 w-auto resize-y leading-normal"
        data-testid="ade-wf-step-prompt"
        @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
      />
      <Card
        v-if="step.prompt"
        class="text-kira-sm text-muted-foreground"
        data-testid="ade-wf-step-preview"
      >
        <VarText :parts="preview" />
      </Card>
    </template>
    <AdeStepSandbox
      :sandbox="step.sandbox"
      :step-id="step.id"
      @patch="(sandbox) => patch({ sandbox })"
    />
    <AdeStepResults :stage-id="stageId" :step="step" :steps="steps" />
    <Card v-if="step.review" class="text-kira-sm text-subtle" data-testid="ade-wf-review-note">
      {{ t('space.ade.workflows.stepInspector.reviewNote.hint') }}
    </Card>
    <Card v-else class="text-kira-sm text-subtle" data-testid="ade-wf-finish-note">
      {{ t('space.ade.workflows.stepInspector.finishNote.hint') }}
      <span class="block pt-1"><VarText :parts="finish" /></span>
    </Card>
  </div>
</template>
