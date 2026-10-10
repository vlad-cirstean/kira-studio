<script setup lang="ts">
import VarText from '@theme/components/VarText.vue';
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';
import { promptParts } from '../automation/smartStepBody';
import { resultHandleId, type StepNodeData } from '../board/workflowGraph';

// One agent step on the canvas: name, what it runs, and one connector per result.
const props = defineProps<{ data: StepNodeData }>();
const step = computed(() => props.data.step);
const body = computed(() => (step.value.smartScript ? `✦ ${step.value.smartScript}` : step.value.prompt));
const parts = computed(() => promptParts(body.value));
</script>

<template>
  <div
    class="flex flex-col rounded-kira border bg-elevated text-kira-sm"
    :class="data.selected ? 'border-info' : 'border-border-strong'"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    data-testid="ade-wf-node"
    :data-step-id="step.id"
    :data-start="data.start"
    :data-selected="data.selected"
  >
    <Handle id="in" type="target" :position="Position.Top" class="!size-2.5 !border-0 !bg-muted-foreground" />
    <div class="flex items-center gap-1.5 px-2.5 pt-2">
      <span v-if="data.start" class="text-tone-green" title="Start" data-testid="ade-wf-node-start">▶</span>
      <span class="min-w-0 flex-1 truncate text-kira-md font-semibold" data-testid="ade-wf-node-name">{{ step.name }}</span>
      <span v-if="step.before === 'approval'" class="shrink-0 text-warn-text" data-testid="ade-wf-node-gate">approval</span>
      <span v-if="step.smartScript" class="shrink-0 text-info">smart</span>
    </div>
    <div class="px-2.5 text-subtle">{{ step.runsOn }}</div>
    <div class="line-clamp-2 min-h-0 flex-1 px-2.5 pt-0.5 text-muted-foreground" data-testid="ade-wf-node-prompt">
      <VarText :parts="parts" />
    </div>
    <div class="flex justify-around border-t border-border">
      <span
        v-for="r in step.results"
        :key="r.id"
        class="relative flex min-w-0 items-center gap-1 px-1.5 py-1"
        data-testid="ade-wf-node-result"
        :data-result="r.id"
        :data-ok="r.ok"
      >
        <span class="size-1.5 shrink-0 rounded-full" :class="r.ok ? 'bg-tone-green-solid' : 'bg-tone-red-solid'" />
        <span class="truncate">{{ r.id }}</span>
        <Handle
          :id="resultHandleId(r.id)"
          type="source"
          :position="Position.Bottom"
          class="!size-3 !border-2 !border-bg"
          :class="r.ok ? '!bg-tone-green-solid' : '!bg-tone-red-solid'"
        />
      </span>
    </div>
  </div>
</template>
