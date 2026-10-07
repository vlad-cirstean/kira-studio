<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { useClipboard } from '@vueuse/core';
import AdeTip from '../AdeTip.vue';
import { useWorkflowYaml } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { WorkflowEntry } from '../wire';
import AdeWorkflowForm from './AdeWorkflowForm.vue';
import AdeWorkflowYaml from './AdeWorkflowYaml.vue';

// One workflow: mode toggle, file path, Copy YAML, then the Form or YAML pane.
const props = defineProps<{ entry: WorkflowEntry }>();
const wfUi = useAdeWorkflowsUiStore();
const yaml = useWorkflowYaml(() => props.entry.fileName);
const { copy, copied } = useClipboard({ copiedDuring: 1500 });

function setMode(v: unknown): void {
  if (v === 'form' || v === 'yaml') wfUi.workflowMode = v;
}
</script>

<template>
  <div class="flex max-w-[900px] flex-col gap-3" data-testid="ade-wf-editor">
    <div class="flex flex-wrap items-center gap-2.5">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        :model-value="wfUi.workflowMode"
        aria-label="Editor mode"
        data-testid="ade-wf-mode"
        @update:model-value="setMode"
      >
        <ToggleGroupItem value="form" class="px-2.5 text-kira-md" data-testid="ade-wf-mode-form">Form</ToggleGroupItem>
        <ToggleGroupItem value="yaml" class="px-2.5 text-kira-md" data-testid="ade-wf-mode-yaml">YAML</ToggleGroupItem>
      </ToggleGroup>
      <AdeTip :text="entry.path">
        <span class="min-w-0 flex-[1_1_200px] truncate font-data text-kira-sm text-subtle" data-testid="ade-wf-path">{{
          entry.path
        }}</span>
      </AdeTip>
      <Button
        variant="dialog"
        size="xs"
        class="px-2.5"
        :disabled="!yaml.data.value"
        data-testid="ade-wf-copy"
        @click="yaml.data.value && copy(yaml.data.value.yaml)"
      >
        {{ copied ? 'Copied' : 'Copy YAML' }}
      </Button>
    </div>
    <AdeWorkflowYaml v-if="wfUi.workflowMode === 'yaml'" :entry="entry" />
    <AdeWorkflowForm v-else :entry="entry" />
  </div>
</template>
