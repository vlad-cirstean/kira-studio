<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import VarText from '@theme/components/VarText.vue';
import ParamsForm from '@workbench/automations/run/ParamsForm.vue';
import { computed, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../../state/customScripts';
import { promptParts, smartBodyParts } from '../automation/smartStepBody';
import { finishStepParts } from '../board/runMessage';
import { formatTools, parseTools } from '../board/workflowForm';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { PipelineStep } from '../wire';
import AdeStepResults from './AdeStepResults.vue';

const MODE_ITEMS = [
  { value: 'prompt', label: 'Prompt', testid: 'ade-wf-step-mode-prompt' },
  { value: 'smart', label: 'Smart script', testid: 'ade-wf-step-mode-smart' },
];

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
      <Label :for="id('name')" class="sr-only">Step name</Label>
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
        {{ isStart ? 'Start step' : 'Make start' }}
      </Button>
      <Button
        variant="dialog"
        size="kira"
        class="text-error"
        data-testid="ade-wf-step-remove"
        @click="draft.deleteStep(stageId, step.id)"
      >
        Remove
      </Button>
    </div>
    <div class="flex flex-wrap items-center gap-3 text-kira-sm text-muted-foreground">
      <Label class="font-normal" :for="id('scope')">Runs on</Label>
      <NativeSelect
        :id="id('scope')"
        variant="bordered"
        :model-value="step.runsOn"
        data-testid="ade-wf-step-scope"
        @update:model-value="(v) => patch({ runsOn: String(v) as PipelineStep['runsOn'] })"
      >
        <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
      </NativeSelect>
      <Label class="font-normal" :for="id('gate')">Before it</Label>
      <NativeSelect
        :id="id('gate')"
        variant="bordered"
        :model-value="step.before"
        data-testid="ade-wf-step-gate"
        @update:model-value="(v) => patch({ before: v === 'approval' ? 'approval' : 'auto' })"
      >
        <option value="auto">start automatically</option>
        <option value="approval">wait for my approval</option>
      </NativeSelect>
      <Label class="font-normal" :for="id('timeout')">Timeout</Label>
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
      :items="MODE_ITEMS"
      data-testid="ade-wf-step-mode"
      @update:model-value="setMode"
    />
    <div v-if="smart" class="flex flex-col gap-2" data-testid="ade-wf-step-smart">
      <Label :for="id('script')" class="font-normal text-kira-sm text-muted-foreground">Smart script</Label>
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
        not found
      </span>
      <ParamsForm
        v-if="script && script.params.length > 0"
        :model-value="step.params"
        :params="script.params"
        @update:model-value="(v) => patch({ params: v })"
      />
      <div
        v-if="script"
        class="rounded-kira-sm border border-border p-2 font-data text-kira-sm whitespace-pre-wrap"
        data-testid="ade-wf-step-body"
      >
        <VarText :parts="bodyParts" />
      </div>
    </div>
    <template v-else>
      <div class="flex flex-col gap-1">
        <Label :for="id('tools')" class="font-normal text-kira-sm text-muted-foreground"
          >Allowed tools <span class="text-subtle">Passed as --allowedTools; deny rules still win.</span></Label
        >
        <Input
          :id="id('tools')"
          :model-value="toolsText"
          placeholder="Bash(git *), Edit"
          size="kira"
          class="font-data"
          data-testid="ade-wf-step-tools"
          @update:model-value="onTools"
        />
      </div>
      <Label :for="id('prompt')" class="sr-only">Prompt</Label>
      <Textarea
        :id="id('prompt')"
        :model-value="step.prompt"
        placeholder="Prompt"
        class="min-h-24 w-auto resize-y leading-normal"
        data-testid="ade-wf-step-prompt"
        @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
      />
      <div
        v-if="step.prompt"
        class="rounded-kira-sm border border-border p-2 text-kira-sm text-muted-foreground"
        data-testid="ade-wf-step-preview"
      >
        <VarText :parts="preview" />
      </div>
    </template>
    <AdeStepResults :stage-id="stageId" :step="step" :steps="steps" />
    <div class="rounded-kira-sm border border-border p-2 text-kira-sm text-subtle" data-testid="ade-wf-finish-note">
      <span class="text-info">+ finish_step instruction</span> is added to this prompt automatically:
      <span class="block pt-1"><VarText :parts="finish" /></span>
    </div>
  </div>
</template>
