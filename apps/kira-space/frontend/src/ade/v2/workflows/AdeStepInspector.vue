<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
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
import { finishStepParts } from '../board/runMessage';
import { formatTools, parseTools, runsOnLabel } from '../board/workflowForm';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { PipelineStep } from '../wire';
import AdeStepResults from './AdeStepResults.vue';

const modeItems = computed(() => [
  { value: 'prompt', label: t('common.prompt.label'), testid: 'ade-wf-step-mode-prompt' },
  { value: 'smart', label: t('common.smartScript.label'), testid: 'ade-wf-step-mode-smart' },
]);

// The selected step: name, run scope, approval gate, timeout, tools, prompt or smart script, results.
const props = defineProps<{ stageId: string; step: PipelineStep; steps: PipelineStep[]; scopes: string[] }>();
const draft = useAdeWorkflowDraftStore();
const patch = (p: Partial<PipelineStep>): void => draft.patchStep(props.stageId, props.step.id, p);

const scripts = useCustomScriptsStore();
const smartScripts = computed(() => scripts.records.filter((r) => r.kind === 'smart'));
const smart = computed(() => props.step.smartScript !== '');
const script = computed(() => smartScripts.value.find((r) => r.name === props.step.smartScript) ?? null);
const mode = computed(() => (smart.value ? 'smart' : 'prompt'));
// A step sets its params by name; switching mode clears the other side.
function setMode(v: string): void {
  if (v === 'smart' && !smart.value) {
    patch({ smartScript: smartScripts.value[0]?.name ?? '', prompt: '', allowedTools: [], params: {} });
  } else if (v === 'prompt' && smart.value) {
    patch({ smartScript: '', params: {} });
  }
}
const bodyParts = computed(() => (script.value ? smartBodyParts(script.value.command, props.step.params) : []));
const preview = computed(() => promptParts(props.step.prompt));
const finish = computed(() => finishStepParts(props.step.results));

const toolsText = ref(formatTools(props.step.allowedTools));
watch(
  () => props.step.allowedTools,
  (tools) => {
    if (formatTools(parseTools(toolsText.value)) !== formatTools(tools)) toolsText.value = formatTools(tools);
  },
);
function onTools(v: string | number): void {
  toolsText.value = String(v);
  patch({ allowedTools: parseTools(toolsText.value) });
}
const id = (k: string): string => `ade-wf-step-${k}-${props.step.id}`;
const isStart = computed(() => props.steps[0]?.id === props.step.id);
</script>

<template>
  <div class="flex flex-col gap-2.5" data-testid="ade-wf-step" :data-step-id="step.id">
    <div class="flex items-center gap-2">
      <Label :for="id('name')" class="sr-only">{{ t('space.ade.workflows.stepInspector.name.aria') }}</Label>
      <Input
        :id="id('name')"
        :model-value="step.name"
        size="kira"
        class="min-w-0 flex-1 font-medium"
        data-testid="ade-wf-step-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
      <Button
        variant="dialog"
        size="kira"
        :disabled="isStart"
        data-testid="ade-wf-step-start"
        @click="draft.makeStart(stageId, step.id)"
      >
        {{ isStart ? t('space.ade.workflows.stepInspector.startStep.label') : t('space.ade.workflows.stepInspector.makeStart.label') }}
      </Button>
      <Button
        variant="dialog"
        size="kira"
        class="text-error"
        data-testid="ade-wf-step-remove"
        @click="draft.deleteStep(stageId, step.id)"
      >
        {{ t('common.action.remove.label') }}
      </Button>
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
    </div>
    <SecondaryTabs
      :model-value="mode"
      :items="modeItems"
      data-testid="ade-wf-step-mode"
      @update:model-value="setMode"
    />
    <div v-if="smart" class="flex flex-col gap-2" data-testid="ade-wf-step-smart">
      <Label :for="id('script')" class="text-kira-sm text-muted-foreground">{{ t('common.smartScript.label') }}</Label>
      <NativeSelect
        :id="id('script')"
        variant="bordered"
        :model-value="step.smartScript"
        data-testid="ade-wf-step-script"
        @update:model-value="(v) => patch({ smartScript: String(v), params: {} })"
      >
        <option v-if="!script && step.smartScript" :value="step.smartScript">{{ step.smartScript }}</option>
        <option v-for="r in smartScripts" :key="r.id" :value="r.name">✦ {{ r.name }}</option>
      </NativeSelect>
      <span v-if="step.smartScript && !script" class="text-kira-sm text-error" data-testid="ade-wf-step-script-missing">
        {{ t('space.ade.workflows.stepInspector.scriptMissing.error') }}
      </span>
      <ParamsForm
        v-if="script && script.params.length > 0"
        :model-value="step.params"
        :params="script.params"
        @update:model-value="(v) => patch({ params: v })"
      />
      <Card v-if="script" class="font-data text-kira-sm whitespace-pre-wrap" data-testid="ade-wf-step-body">
        <VarText :parts="bodyParts" />
      </Card>
    </div>
    <template v-else>
      <div class="flex flex-col gap-1">
        <Label :for="id('tools')" class="text-kira-sm text-muted-foreground"
          >{{ t('space.ade.workflows.stepInspector.tools.label') }}
          <span class="text-subtle">{{ t('space.ade.workflows.stepInspector.tools.hint') }}</span></Label
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
      <Card v-if="step.prompt" class="text-kira-sm text-muted-foreground" data-testid="ade-wf-step-preview">
        <VarText :parts="preview" />
      </Card>
    </template>
    <AdeStepResults :stage-id="stageId" :step="step" :steps="steps" />
    <Card class="text-kira-sm text-subtle" data-testid="ade-wf-finish-note">
      {{ t('space.ade.workflows.stepInspector.finishNote.hint') }}
      <span class="block pt-1"><VarText :parts="finish" /></span>
    </Card>
  </div>
</template>
