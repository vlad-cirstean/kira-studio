<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, watch } from 'vue';
import AdeTip from '../AdeTip.vue';
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
    class="flex flex-col gap-1.5 rounded-kira border border-border-strong bg-bg px-2.5 py-2"
    data-testid="ade-wf-step"
    :data-step-id="step.id"
  >
    <div class="flex items-center gap-2">
      <span class="w-[30px] shrink-0 font-data text-kira-md font-bold text-warn-text">{{ label }}</span>
      <label :for="id('name')" class="sr-only">Step name</label>
      <Input
        :id="id('name')"
        :model-value="step.name"
        class="min-w-0 flex-1 bg-field font-semibold"
        data-testid="ade-wf-step-name"
        @update:model-value="(v: string | number) => patch({ name: String(v) })"
      />
      <Button variant="dialog" size="icon-xs" class="size-6" aria-label="Move step up" :disabled="first" data-testid="ade-wf-step-up" @click="emit('up')">↑</Button>
      <Button variant="dialog" size="icon-xs" class="size-6" aria-label="Move step down" :disabled="last" data-testid="ade-wf-step-down" @click="emit('down')">↓</Button>
      <Button variant="dialog" size="icon-xs" class="size-6 text-error" aria-label="Remove step" data-testid="ade-wf-step-remove" @click="emit('remove')">✕</Button>
    </div>
    <div class="flex flex-wrap items-center gap-3 pl-[38px] text-kira-sm text-muted-foreground">
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
        class="w-14 bg-field px-1.5 font-data"
        data-testid="ade-wf-step-timeout"
        @update:model-value="(v: string | number) => patch({ timeout: String(v) })"
      />
    </div>
    <div class="flex flex-col gap-1 pl-[38px]">
      <label :for="id('tools')" class="text-kira-sm text-muted-foreground"
        >Allowed tools
        <span class="text-subtle">Passed as --allowedTools; deny rules still win.</span></label
      >
      <Input
        :id="id('tools')"
        :model-value="toolsText"
        placeholder="Bash(git *), Edit"
        class="bg-bg font-data"
        data-testid="ade-wf-step-tools"
        @update:model-value="onTools"
      />
    </div>
    <label :for="id('prompt')" class="sr-only">Prompt</label>
    <Textarea
      :id="id('prompt')"
      :model-value="step.prompt"
      placeholder="Prompt"
      class="ml-[38px] min-h-11 w-auto resize-y bg-bg px-2 py-1.5 font-data leading-normal"
      data-testid="ade-wf-step-prompt"
      @update:model-value="(v: string | number) => patch({ prompt: String(v) })"
    />
    <AdeTip :text="FINISH_NOTE">
      <div class="ml-[38px] cursor-help text-kira-sm text-subtle" data-testid="ade-wf-finish-note">
        <span class="text-info">+ finish_step instruction</span> is added to this prompt automatically (hover to read it)
      </div>
    </AdeTip>
  </div>
</template>
