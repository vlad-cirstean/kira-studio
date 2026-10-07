<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { useDebounceFn } from '@vueuse/core';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { cloneWorkflow, moved, newStage } from '../board/workflowForm';
import { useRepos, useSaveWorkflow } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { Stage, Workflow, WorkflowEntry } from '../wire';
import AdeStageCard from './AdeStageCard.vue';

// Form mode (R26): edits a local copy of the last valid workflow and saves it whole, 500 ms after
// the last edit and on leaving. A push never replaces a copy that has unsaved edits.
const props = defineProps<{ entry: WorkflowEntry }>();
const wfUi = useAdeWorkflowsUiStore();
const repos = useRepos();
const save = useSaveWorkflow();

const wf = ref<Workflow | null>(props.entry.workflow ? cloneWorkflow(props.entry.workflow) : null);
const dirty = ref(false);
const error = ref('');

watch(
  () => props.entry.workflow,
  (w) => {
    if (!dirty.value && w) wf.value = cloneWorkflow(w);
  },
);

const scopes = computed(() => [
  'once',
  'each repo',
  ...(repos.data.value?.repos ?? []).map((r) => `only ${r.nickname || r.name}`),
]);

async function flush(): Promise<void> {
  const current = wf.value;
  if (!dirty.value || !current) return;
  const sent = JSON.stringify(current);
  try {
    await save.mutateAsync({ fileName: props.entry.fileName, workflow: current });
    error.value = '';
    if (JSON.stringify(wf.value) === sent) dirty.value = false;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}
const scheduleSave = useDebounceFn(flush, 500);

function edit(next: Workflow): void {
  wf.value = next;
  dirty.value = true;
  void scheduleSave();
}
function setStages(stages: Stage[]): void {
  if (wf.value) edit({ ...wf.value, stages });
}

onBeforeUnmount(() => {
  void flush();
});
</script>

<template>
  <div v-if="wf" class="flex flex-col gap-3" data-testid="ade-wf-form">
    <div class="flex flex-wrap items-center gap-2.5">
      <label for="ade-wf-form-name" class="text-kira-sm text-muted-foreground">Name</label>
      <Input
        id="ade-wf-form-name"
        :model-value="wf.name"
        class="w-80 bg-field font-semibold"
        data-testid="ade-wf-form-name"
        @update:model-value="(v: string | number) => edit({ ...wf as Workflow, name: String(v) })"
      />
      <span class="text-kira-sm text-subtle"
        >Prompt variables: <span class="font-data">{task} {jira} {repo} {branch} {worktree}</span></span
      >
    </div>
    <AdeStageCard
      v-for="(s, i) in wf.stages"
      :key="s.id"
      :stage="s"
      :index="i"
      :scopes="scopes"
      :first="i === 0"
      :last="i === wf.stages.length - 1"
      @update:stage="(v) => setStages((wf as Workflow).stages.map((x, k) => (k === i ? v : x)))"
      @up="setStages(moved((wf as Workflow).stages, i, 'up'))"
      @down="setStages(moved((wf as Workflow).stages, i, 'down'))"
      @remove="setStages((wf as Workflow).stages.filter((_, k) => k !== i))"
    />
    <Button
      variant="dialog"
      size="sm"
      class="self-start border-dashed bg-transparent px-3"
      data-testid="ade-wf-add-stage"
      @click="setStages([...wf.stages, newStage(wf.stages)])"
    >
      + Add stage
    </Button>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-wf-save-error">
      {{ error }}
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent p-0 text-kira-sm text-info underline"
        data-testid="ade-wf-switch-yaml"
        @click="wfUi.workflowMode = 'yaml'"
      >
        Switch to YAML
      </button>
    </p>
  </div>
  <p v-else class="m-0 text-kira-md text-muted-foreground" data-testid="ade-wf-no-valid">
    This file has no valid version yet.
    <button
      type="button"
      class="cursor-pointer border-0 bg-transparent p-0 text-kira-md text-info underline"
      @click="wfUi.workflowMode = 'yaml'"
    >
      Fix it in YAML
    </button>
  </p>
</template>
