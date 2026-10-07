<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Switch } from '@theme/components/ui/switch';
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { cloneWorkflow, moved, newStage, runnableCount } from '../board/workflowForm';
import { useRepos, useSaveWorkflow } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { Stage, Workflow, WorkflowEntry } from '../wire';
import AdeStageCard from './AdeStageCard.vue';
import AdeWorkflowSaveBar from './AdeWorkflowSaveBar.vue';
import { useSaveShortcut } from './useSaveShortcut';

// Form mode (R26): edits a local copy of the last valid workflow; Save writes it whole, Discard drops
// the edits. A push never replaces a copy that has unsaved edits.
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

watch(dirty, (v) => {
  wfUi.dirty = v;
});

async function saveNow(): Promise<void> {
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

function discard(): void {
  if (props.entry.workflow) wf.value = cloneWorkflow(props.entry.workflow);
  dirty.value = false;
  error.value = '';
}

function edit(next: Workflow): void {
  wf.value = next;
  dirty.value = true;
}
function setStages(stages: Stage[]): void {
  if (wf.value) edit({ ...wf.value, stages });
}

const root = useTemplateRef<HTMLElement>('root');
useSaveShortcut(root, () => void saveNow());

onBeforeUnmount(() => {
  wfUi.dirty = false;
});
</script>

<template>
  <div
    v-if="wf"
    class="flex flex-col gap-3"
    ref="root"
    data-testid="ade-wf-form"
  >
    <AdeWorkflowSaveBar :dirty="dirty" :saving="save.isPending.value" @save="saveNow" @discard="discard" />
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
    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-2.5 text-kira-md">
        <Switch
          id="ade-wf-form-space"
          :model-value="wf.kiraSpaceMcp"
          data-testid="ade-wf-form-space"
          @update:model-value="(v: boolean) => edit({ ...(wf as Workflow), kiraSpaceMcp: v })"
        />
        <label for="ade-wf-form-space">Kira Space tools for agents</label>
      </div>
      <p class="m-0 pl-[calc(var(--spacing)*10)] text-kira-sm text-subtle">
        Agent steps can declare repos on the task and request branches and worktrees through Kira Space.
      </p>
    </div>
    <AdeStageCard
      v-for="(s, i) in wf.stages"
      :key="s.id"
      :stage="s"
      :index="i"
      :scopes="scopes"
      :first="i === 0"
      :last="i === wf.stages.length - 1"
      :can-skip="runnableCount(wf.stages) > 1"
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
