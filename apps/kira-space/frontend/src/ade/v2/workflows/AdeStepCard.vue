<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import VarText from '@theme/components/VarText.vue';
import ParamsForm from '@workbench/automations/run/ParamsForm.vue';
import { computed, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../../state/customScripts';
import AdeTip from '../AdeTip.vue';
import { smartBodyParts } from '../automation/smartStepBody';
import { FINISH_STEP_SUFFIX } from '../board/runMessage';
import { backOptions, FAILURE_OPTIONS, formatTools, parseTools } from '../board/workflowForm';
import type { OnFailure, PipelineStep } from '../wire';

// One step of an agent stage: name, run scope, approval gate, failure rule, timeout, tools, prompt.
const props = defineProps<{
  steps: PipelineStep[];
  index: number;
  label: string;
  scopes: string[];
  first: boolean;
  last: boolean;
}>();
const step = defineModel<PipelineStep>('step', { required: true });
const emit = defineEmits<{ up: []; down: []; remove: [] }>();

function patch(p: Partial<PipelineStep>): void {
  step.value = { ...step.value, ...p };
}

const scripts = useCustomScriptsStore();
const smartScripts = computed(() => scripts.records.filter((r) => r.kind === 'smart'));
const smart = computed(() => step.value.smartScript !== '');
const script = computed(() => smartScripts.value.find((r) => r.name === step.value.smartScript) ?? null);
const mode = computed(() => (smart.value ? 'smart' : 'prompt'));
// A step sets its params by name; switching mode clears the other side.
function setMode(v: string): void {
  if (v === 'smart' && !smart.value) {
    patch({ smartScript: smartScripts.value[0]?.name ?? '', prompt: '', allowedTools: [], params: {} });
  } else if (v === 'prompt' && smart.value) {
    patch({ smartScript: '', params: {} });
  }
}
function pickScript(name: string): void {
  patch({ smartScript: name, params: {} });
}
const bodyParts = computed(() => (script.value ? smartBodyParts(script.value.command, step.value.params) : []));

const toolsText = ref(formatTools(step.value.allowedTools));
watch(
  () => step.value.allowedTools,
  (tools) => {
    if (formatTools(parseTools(toolsText.value)) !== formatTools(tools)) toolsText.value = formatTools(tools);
  },
);
function onTools(v: string | number): void {
  toolsText.value = String(v);
  patch({ allowedTools: parseTools(toolsText.value) });
}

const failOptions = computed(() => [
  ...FAILURE_OPTIONS.map((o) => ({ value: o, label: o })),
  ...backOptions(props.steps, props.index),
]);
const id = (k: string): string => `ade-wf-step-${k}-${props.label}`;
const FINISH_NOTE = `${FINISH_STEP_SUFFIX}\n\nValues of {task} {jira} {repo} {branch} {worktree} are filled in per run; script commands get them shell-quoted when needed.`;
</script>

<template>
  <div
    class="flex flex-col gap-1.5 py-2.5"
    data-testid="ade-wf-step"
    :data-step-id="step.id"
  >
    <div class="flex items-center gap-2">
      <span class="w-7.5 shrink-0 text-kira-md font-bold text-warn-text">{{ label }}</span>
      <label :for="id('name')" class="sr-only">Step name</label>
      <Input
        :id="id('name')"
        :model-value="step.name"
        size="kira" class="min-w-0 flex-1 font-semibold"
        data-testid="ade-wf-step-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
      <TooltipIconButton icon="arrow-up" label="Move step up" :disabled="first" data-testid="ade-wf-step-up" @click="emit('up')" />
      <TooltipIconButton icon="arrow-down" label="Move step down" :disabled="last" data-testid="ade-wf-step-down" @click="emit('down')" />
      <TooltipIconButton icon="close" label="Remove step" class="text-error" data-testid="ade-wf-step-remove" @click="emit('remove')" />
    </div>
    <div class="flex flex-wrap items-center gap-3 pl-9.5 text-kira-sm text-muted-foreground">
      <label :for="id('scope')">Runs on</label>
      <NativeSelect
        :id="id('scope')"
        variant="bordered"
        :model-value="step.runsOn"
        data-testid="ade-wf-step-scope"
        @update:model-value="(v) => patch({ runsOn: String(v) as PipelineStep['runsOn'] })"
      >
        <option v-for="s in scopes" :key="s" :value="s">{{ s }}</option>
      </NativeSelect>
      <label :for="id('gate')">Before it</label>
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
      <label :for="id('fail')">On failure</label>
      <NativeSelect
        :id="id('fail')"
        variant="bordered"
        :model-value="step.onFailure"
        data-testid="ade-wf-step-fail"
        @update:model-value="(v) => patch({ onFailure: String(v) as OnFailure })"
      >
        <option v-for="o in failOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
      </NativeSelect>
      <label :for="id('timeout')">Timeout</label>
      <Input
        :id="id('timeout')"
        :model-value="step.timeout"
        size="kira" class="w-14 px-1.5"
        data-testid="ade-wf-step-timeout"
        @update:model-value="(v: string | number) => patch({ timeout: String(v) })"
      />
    </div>
    <ToggleGroup
      type="single"
      size="kira"
      class="pl-9.5"
      :model-value="mode"
      data-testid="ade-wf-step-mode"
      @update:model-value="(v) => v && setMode(String(v))"
    >
      <ToggleGroupItem value="prompt" data-testid="ade-wf-step-mode-prompt">Prompt</ToggleGroupItem>
      <ToggleGroupItem value="smart" data-testid="ade-wf-step-mode-smart">Smart script</ToggleGroupItem>
    </ToggleGroup>
    <div v-if="smart" class="flex flex-col gap-2 pl-9.5" data-testid="ade-wf-step-smart">
      <label :for="id('script')" class="text-kira-sm text-muted-foreground">Smart script</label>
      <NativeSelect
        :id="id('script')"
        variant="bordered"
        :model-value="step.smartScript"
        data-testid="ade-wf-step-script"
        @update:model-value="(v) => pickScript(String(v))"
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
    <div v-if="!smart" class="flex flex-col gap-1 pl-9.5">
      <label :for="id('tools')" class="text-kira-sm text-muted-foreground"
        >Allowed tools
        <span class="text-subtle">Passed as --allowedTools; deny rules still win.</span></label
      >
      <Input
        :id="id('tools')"
        :model-value="toolsText"
        placeholder="Bash(git *), Edit"
       
        size="kira"
        class="bg-bg font-data"
        data-testid="ade-wf-step-tools"
        @update:model-value="onTools"
      />
    </div>
    <label v-if="!smart" :for="id('prompt')" class="sr-only">Prompt</label>
    <Textarea
      v-if="!smart"
      :id="id('prompt')"
      :model-value="step.prompt"
      placeholder="Prompt"
      class="ml-9.5 min-h-12 w-auto resize-y bg-bg px-2 py-1.5 leading-normal"
      data-testid="ade-wf-step-prompt"
      @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
    />
    <div v-if="smart" class="ml-9.5 text-kira-sm text-subtle" data-testid="ade-wf-smart-note">
      <span class="text-info">+ finish_step instruction</span> is added to this prompt automatically. Values of
      {task} {jira} {repo} {branch} {worktree} are filled in per run.
    </div>
    <AdeTip v-if="!smart" :text="FINISH_NOTE">
      <div class="ml-9.5 cursor-help text-kira-sm text-subtle" data-testid="ade-wf-finish-note">
        <span class="text-info">+ finish_step instruction</span> is added to this prompt automatically (hover to read it)
      </div>
    </AdeTip>
  </div>
</template>
