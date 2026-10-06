<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { NativeSelect } from '@theme/components/ui/native-select';
import { computed, ref } from 'vue';
import type { CardModel } from '../plan/usePlanModel';
import { useSetTaskWorkflow, useWorkflows } from '../queries';
import AdeTaskActionButton from '../run/AdeTaskActionButton.vue';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import AdeStageBlock from './AdeStageBlock.vue';

// Task tab Workflow section (SPEC2 section 7): the workflow picker, then one block per stage.
const props = defineProps<{ card: CardModel }>();
const wfUi = useAdeWorkflowsUiStore();
const workflows = useWorkflows();
const setWorkflow = useSetTaskWorkflow();
const error = ref('');

const valid = computed(() =>
  (workflows.data.value?.workflows ?? []).flatMap((e) => (e.workflow ? [{ file: e.fileName, wf: e.workflow }] : [])),
);

async function pick(value: unknown): Promise<void> {
  error.value = '';
  try {
    await setWorkflow.mutateAsync({ taskId: props.card.task.id, workflowId: String(value ?? '') });
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

function edit(): void {
  const hit = valid.value.find((v) => v.wf.id === props.card.task.workflowId);
  wfUi.openWorkflow(hit?.file ?? null);
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="ade-workflow-block">
    <div class="flex items-center gap-2">
      <span class="text-kira-sm text-muted-foreground">Workflow</span>
      <label for="ade-workflow-select" class="sr-only">Workflow</label>
      <NativeSelect
        id="ade-workflow-select"
        variant="bordered"
        class="h-6 text-kira-md"
        :model-value="card.task.workflowId"
        data-testid="ade-workflow-select"
        @update:model-value="pick"
      >
        <option v-if="card.task.workflowId === ''" value="">Pick a workflow…</option>
        <option v-for="v in valid" :key="v.wf.id" :value="v.wf.id">{{ v.wf.name }}</option>
      </NativeSelect>
      <Button
        variant="link"
        size="xs"
        class="h-[22px] px-2 text-kira-sm text-info"
        data-testid="ade-edit-workflows"
        @click="edit"
      >
        Edit workflows ↗
      </Button>
    </div>
    <p v-if="error" class="m-0 text-kira-sm text-error" data-testid="ade-workflow-error">{{ error }}</p>
    <AdeStageBlock v-for="b in card.blocks" :key="b.stage.id" :block="b" :card="card">
      <template #action>
        <AdeTaskActionButton v-if="b.state === 'now'" :card="card" />
      </template>
    </AdeStageBlock>
  </div>
</template>
