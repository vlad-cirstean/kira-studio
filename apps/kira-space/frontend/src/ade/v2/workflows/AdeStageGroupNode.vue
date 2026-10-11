<script setup lang="ts">
import { t } from '@theme/i18n';
import { Handle, Position } from '@vue-flow/core';
import { computed } from 'vue';
import AdeChip from '../AdeChip.vue';
import type { Tone } from '../board/actions';
import { failureLabel, kindLabel } from '../board/workflowForm';
import type { StageNodeData } from '../board/workflowGraph';
import type { StageKind } from '../wire';

// A stage on the canvas: the frame around an agent stage's steps, or a whole user or script stage.
const props = defineProps<{ data: StageNodeData }>();
const KIND_TONE: Record<StageKind, Tone> = { user: 'blue', agent: 'amber', script: 'green' };
const stage = computed(() => props.data.stage);
const agent = computed(() => stage.value.kind === 'agent');
const handleStyle = computed(() => (props.data.spineX === undefined ? {} : { left: `${props.data.spineX}px` }));
const detail = computed(() => {
  const s = stage.value;
  if (s.kind === 'script') {
    const command = s.command || t('space.ade.workflows.stageNode.noCommand.label');
    return s.onFailure.startsWith('retry')
      ? t('common.dotPair.label', { first: command, second: failureLabel(s.onFailure) })
      : command;
  }
  return s.session ? t('space.ade.workflows.stageNode.session.label') : t('space.ade.workflows.stageNode.manual.label');
});
</script>

<template>
  <div
    class="rounded-kira-pill border bg-elevated/60"
    :class="[
      data.selected ? 'border-info' : 'border-muted-foreground/50',
      agent ? 'border-dashed' : 'border-solid',
      stage.skip ? 'opacity-60' : '',
    ]"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    data-testid="ade-wf-stage-node"
    :data-stage-id="stage.id"
    :data-selected="data.selected"
    :data-skipped="stage.skip"
  >
    <Handle
      id="in"
      type="target"
      :position="Position.Top"
      class="!size-2 !border-0 !bg-muted-foreground"
      :style="handleStyle"
    />
    <div class="flex items-center gap-1.5 px-3" :class="agent ? 'h-row' : 'pt-2'">
      <span class="font-medium">{{ data.index + 1 }}.</span>
      <span class="min-w-0 flex-1 truncate font-medium" :class="stage.skip ? 'line-through' : ''">{{ stage.name }}</span>
      <AdeChip :label="kindLabel(stage.kind)" :tone="KIND_TONE[stage.kind]" />
    </div>
    <div v-if="!agent" class="truncate px-3 text-kira-sm text-subtle" data-testid="ade-wf-stage-node-detail">{{ detail }}</div>
    <Handle
      id="out"
      type="source"
      :position="Position.Bottom"
      class="!size-2 !border-0 !bg-muted-foreground"
      :style="handleStyle"
    />
  </div>
</template>
