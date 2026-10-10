<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import { useClipboard } from '@vueuse/core';
import { defineAsyncComponent } from 'vue';
import AdeTip from '../AdeTip.vue';
import { useWorkflowYaml } from '../queries';
import { useAdeWorkflowsUiStore } from '../state/adeWorkflowsUi';
import type { WorkflowEntry } from '../wire';
import AdeWorkflowYaml from './AdeWorkflowYaml.vue';

// One workflow: mode toggle, file path, Copy YAML, then the Graph or YAML pane. The graph editor (Vue Flow)
// loads on first use so the board bundle does not carry it.
const AdeWorkflowGraph = defineAsyncComponent(() => import('./AdeWorkflowGraph.vue'));
const MODE_ITEMS = [
  { value: 'graph', label: 'Graph', testid: 'ade-wf-mode-graph' },
  { value: 'yaml', label: 'YAML', testid: 'ade-wf-mode-yaml' },
];
const props = defineProps<{ entry: WorkflowEntry }>();
const wfUi = useAdeWorkflowsUiStore();
const yaml = useWorkflowYaml(() => props.entry.fileName);
const { copy, copied } = useClipboard({ copiedDuring: 1500 });

async function setMode(v: unknown): Promise<void> {
  if ((v !== 'graph' && v !== 'yaml') || v === wfUi.workflowMode) return;
  if (await wfUi.leave()) wfUi.workflowMode = v;
}
</script>

<template>
  <div
    class="flex flex-col gap-3"
    :class="wfUi.workflowMode === 'yaml' ? 'max-w-4xl' : 'h-full min-h-0'"
    data-testid="ade-wf-editor"
  >
    <div class="flex flex-wrap items-center gap-2.5">
      <SecondaryTabs
        variant="segmented"
        size="kira-lg"
        :model-value="wfUi.workflowMode"
        :items="MODE_ITEMS"
        aria-label="Editor mode"
        data-testid="ade-wf-mode"
        @update:model-value="setMode"
      />
      <AdeTip :text="entry.path">
        <span class="min-w-0 flex-1 truncate font-data text-kira-sm text-subtle" data-testid="ade-wf-path">{{
          entry.path
        }}</span>
      </AdeTip>
      <Button
        variant="dialog"
        size="kira-lg"
        :disabled="!yaml.data.value"
        data-testid="ade-wf-copy"
        @click="yaml.data.value && copy(yaml.data.value.yaml)"
      >
        {{ copied ? 'Copied' : 'Copy YAML' }}
      </Button>
    </div>
    <AdeWorkflowYaml v-if="wfUi.workflowMode === 'yaml'" :entry="entry" />
    <AdeWorkflowGraph v-else :entry="entry" />
  </div>
</template>
