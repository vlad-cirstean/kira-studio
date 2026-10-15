<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { t } from '@theme/i18n';
import { ICON } from '@theme/icons';
import { Handle, Position } from '@vue-flow/core';
import { useEventListener } from '@vueuse/core';
import { computed, ref, useTemplateRef } from 'vue';
import AdeChip from '../AdeChip.vue';
import type { Tone } from '../board/actions';
import { failureLabel, kindLabel } from '../board/workflowForm';
import type { StageNodeData } from '../board/workflowGraph';
import { useAdeWorkflowDraftStore } from '../state/adeWorkflowDraft';
import type { StageKind } from '../wire';

// A stage on the canvas: the frame around an agent stage's steps, or a whole user or script stage.
// Its menu holds the structure actions: add a step or a stage, move, skip, remove.
const props = defineProps<{ data: StageNodeData }>();
const draft = useAdeWorkflowDraftStore();
const KIND_TONE: Record<StageKind, Tone> = { user: 'blue', agent: 'amber', script: 'green' };
const stage = computed(() => props.data.stage);
const agent = computed(() => stage.value.kind === 'agent');
const menuOpen = ref(false);
const root = useTemplateRef<HTMLElement>('root');
useEventListener(root, 'contextmenu', (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  menuOpen.value = true;
});
const handleStyle = computed(() =>
  props.data.spineX === undefined ? {} : { left: `${props.data.spineX}px` },
);
const detail = computed(() => {
  const s = stage.value;
  if (s.kind === 'script') {
    const command = s.command || t('space.ade.workflows.stageNode.noCommand.label');
    return s.onFailure.startsWith('retry')
      ? t('common.dotPair.label', { first: command, second: failureLabel(s.onFailure) })
      : command;
  }
  return s.session
    ? t('space.ade.workflows.stageNode.session.label')
    : t('space.ade.workflows.stageNode.manual.label');
});
</script>

<template>
  <div
    class="rounded-kira-pill border bg-elevated/60"
    :class="[
      data.selected ? 'border-info' : 'border-muted-foreground/50',
      agent ? 'border-dashed' : 'border-solid',
      stage.skip ? 'text-muted-foreground' : '',
    ]"
    :style="{ width: `${data.w}px`, height: `${data.h}px` }"
    ref="root"
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
      <span class="min-w-0 flex-1 truncate font-medium" :class="stage.skip ? 'line-through' : ''">{{
        stage.name
      }}</span>
      <AdeChip :label="kindLabel(stage.kind)" :tone="KIND_TONE[stage.kind]" />
      <Button
        v-if="agent"
        variant="dialog"
        size="kira"
        class="nodrag nopan"
        data-testid="ade-wf-add-step"
        :data-stage-id="stage.id"
        @click.stop="draft.createStep(stage.id)"
      >
        {{ t('space.ade.workflows.stageInspector.addStep.label') }}
      </Button>
      <DropdownMenu v-model:open="menuOpen">
        <DropdownMenuTrigger as-child>
          <Button
            variant="toolbar"
            size="kira-icon"
            class="nodrag nopan"
            :aria-label="t('space.ade.workflows.graph.stageMenu.aria')"
            data-testid="ade-wf-stage-menu"
            @click.stop
          >
            <CodiconIcon :name="ICON.moreActions" :size="13" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            v-if="agent"
            data-testid="ade-wf-stage-add-step"
            @select="draft.createStep(stage.id)"
          >
            {{ t('space.ade.workflows.stageInspector.addStep.label') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="ade-wf-stage-add-after"
            @select="draft.createStage(stage.id)"
          >
            {{ t('space.ade.workflows.graph.addStageAfter.label') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="data.index === 0"
            data-testid="ade-wf-stage-up"
            @select="draft.moveStageBy(stage.id, -1)"
          >
            {{ t('common.moveUp.tooltip') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="data.index >= data.count - 1"
            data-testid="ade-wf-stage-down"
            @select="draft.moveStageBy(stage.id, 1)"
          >
            {{ t('common.moveDown.tooltip') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="!stage.skip && !draft.canSkip"
            data-testid="ade-wf-stage-skip"
            @select="draft.patchStage(stage.id, { skip: !stage.skip })"
          >
            {{
              stage.skip
                ? t('space.ade.workflows.stageInspector.unskip.label')
                : t('space.ade.workflows.stageInspector.skip.label')
            }}
          </DropdownMenuItem>
          <DropdownMenuItem
            class="text-error"
            data-testid="ade-wf-stage-remove"
            @select="draft.removeStage(stage.id)"
          >
            {{ t('space.ade.workflows.stageInspector.remove.label') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
    <div
      v-if="!agent"
      class="truncate px-3 text-kira-sm text-subtle"
      data-testid="ade-wf-stage-node-detail"
      >{{
        detail
      }}</div
    >
    <Handle
      id="out"
      type="source"
      :position="Position.Bottom"
      class="!size-2 !border-0 !bg-muted-foreground"
      :style="handleStyle"
    />
  </div>
</template>
