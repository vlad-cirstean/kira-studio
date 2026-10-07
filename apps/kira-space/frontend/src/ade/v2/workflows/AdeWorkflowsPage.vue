<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import PanelHeader from '@workbench/components/PanelHeader.vue';
import { computed, ref, watch } from 'vue';
import AdeTip from '../AdeTip.vue';
import { useImportWorkflow, useNewWorkflow, useWorkflows } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import { TONE } from '../tones';
import type { WorkflowEntry } from '../wire';
import AdeWorkflowEditor from './AdeWorkflowEditor.vue';

// Workflows page (SPEC2 section 5.1): the list of workflow files beside the editor for the picked one.
const wfUi = useAdeWorkflowsUiStore();
const workflows = useWorkflows();
const importWf = useImportWorkflow();
const newWf = useNewWorkflow();

const entries = computed(() => workflows.data.value?.workflows ?? []);
const dir = computed(() => workflows.data.value?.dir ?? '');
const current = computed(
  () => entries.value.find((e) => e.fileName === wfUi.workflowFile) ?? entries.value[0] ?? null,
);

// A file that is broken on disk has no form to show: open it in YAML mode.
watch(
  () => current.value?.fileName,
  () => {
    if (current.value?.error) wfUi.workflowMode = 'yaml';
  },
  { immediate: true },
);

const importOpen = ref(false);
const importPath = ref('');
const listError = ref('');

function stages(e: WorkflowEntry): string {
  return e.workflow ? e.workflow.stages.map((s) => s.name).join(' › ') : '';
}

async function runImport(): Promise<void> {
  const path = importPath.value.trim();
  if (!path) return;
  listError.value = '';
  try {
    const entry = await importWf.mutateAsync({ path });
    wfUi.workflowFile = entry.fileName;
    wfUi.workflowMode = 'yaml';
    importPath.value = '';
    importOpen.value = false;
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  }
}

async function createNew(): Promise<void> {
  listError.value = '';
  try {
    const entry = await newWf.mutateAsync({ name: 'New workflow' });
    wfUi.workflowFile = entry.fileName;
    wfUi.workflowMode = 'form';
  } catch (err) {
    listError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 gap-0.5" data-testid="ade-workflows">
    <div
      class="flex w-75 shrink-0 flex-col overflow-hidden rounded-kira border border-border bg-bg"
      data-testid="ade-wf-list"
    >
      <PanelHeader>
        Workflows
        <template #actions>
        <Button
          variant="dialog"
          size="xs"
          class="h-6 text-kira-sm"
          data-testid="ade-wf-import"
          @click="importOpen = !importOpen"
        >
          Import YAML
        </Button>
        <Button variant="dialog" size="xs" class="h-6 text-kira-sm" data-testid="ade-wf-new" @click="createNew">
          + New
        </Button>
        </template>
      </PanelHeader>
      <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-auto p-2">
      <div v-if="importOpen" class="flex flex-col gap-1 pb-2" data-testid="ade-wf-import-row">
        <div class="flex gap-1.5">
          <label for="ade-wf-import-path" class="sr-only">Workflow YAML path</label>
          <Input
            id="ade-wf-import-path"
            v-model="importPath"
            placeholder="~/…/workflow.yaml"
            class="h-[26px] min-w-0 flex-1 border-dashed bg-transparent font-data text-kira-sm"
            data-testid="ade-wf-import-path"
            @keydown.enter="runImport"
          />
          <Button
            variant="dialog"
            size="xs"
            class="h-[26px] text-kira-sm"
            :disabled="importWf.isPending.value"
            data-testid="ade-wf-import-go"
            @click="runImport"
          >
            Import
          </Button>
        </div>
      </div>
      <p v-if="listError" class="m-0 px-1 pb-1 text-kira-sm text-error" data-testid="ade-wf-error">{{ listError }}</p>
      <p
        v-if="workflows.isSuccess.value && entries.length === 0"
        class="m-0 px-1 py-2 text-kira-sm text-subtle"
        data-testid="ade-wf-empty"
      >
        No workflows yet. Workflows are YAML files in {{ dir }}.
      </p>
      <button
        v-for="e in entries"
        :key="e.fileName"
        type="button"
        class="box-border flex w-full cursor-pointer flex-col gap-0.5 rounded-kira border-0 border-l-[3px] px-2.5 py-2 text-left text-fg"
        :class="current?.fileName === e.fileName ? 'bg-hover' : 'bg-transparent'"
        :style="{ borderLeftColor: current?.fileName === e.fileName ? TONE.amber[2] : 'transparent' }"
        data-testid="ade-wf-row"
        :data-file="e.fileName"
        @click="wfUi.workflowFile = e.fileName"
      >
        <span class="flex w-full items-center gap-1.5">
          <span class="min-w-0 flex-1 truncate text-kira-lg font-semibold" data-testid="ade-wf-row-name">{{
            e.workflow?.name ?? e.fileName
          }}</span>
          <AdeTip v-if="e.error" :text="e.error.message">
            <span class="shrink-0 text-kira-sm font-bold" :style="{ color: TONE.red[1] }" data-testid="ade-wf-row-error">✕</span>
          </AdeTip>
        </span>
        <span class="max-w-full truncate text-kira-sm text-muted-foreground" data-testid="ade-wf-row-stages">{{ stages(e) }}</span>
        <span class="text-kira-sm text-subtle" data-testid="ade-wf-row-used">used by {{ e.usedBy }}</span>
      </button>
      <div class="px-1 pt-3 text-kira-sm leading-normal text-subtle">
        A workflow is the list of stages a task goes through. User stages are yours (optionally with an
        interactive Claude Code session). Agent stages run AI steps in the background with
        <span class="font-data">claude -p</span>. Script stages run a command. Each stage sets the task
        status.
      </div>
      </div>
    </div>
    <div class="min-w-0 flex-1 overflow-auto rounded-kira border border-border bg-bg px-6 pb-6 pt-4">
      <AdeWorkflowEditor v-if="current" :key="current.fileName" :entry="current" />
    </div>
  </div>
</template>
