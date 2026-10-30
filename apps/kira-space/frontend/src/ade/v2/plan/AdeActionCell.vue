<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { TooltipDisabledTrigger } from '@theme/components/ui/tooltip';
import type { TextPart } from '@theme/varText';
import { computed } from 'vue';
import AdeChip from '../AdeChip.vue';
import AdeTip from '../AdeTip.vue';
import { type BranchAction, type Tone, tagLabel } from '../board/actions';
import AdeBranchTip from './AdeBranchTip.vue';
import { type BranchRowModel, usePlanModel } from './usePlanModel';

// One cell of the left action column: the derived tag and, for a branch, its action buttons.
const props = defineProps<{
  tag: { label: string; tone: Tone; tip: string; tipParts?: readonly TextPart[]; since?: number };
  tall?: boolean;
  actions?: readonly BranchAction[];
  row?: BranchRowModel;
  color?: string | null;
}>();
const { liveNow } = usePlanModel();
const label = computed(() => tagLabel(props.tag, liveNow.value.getTime()));
const emit = defineEmits<{ act: [action: BranchAction] }>();

const ACTION_VARIANT: Record<BranchAction['kind'], 'dialog' | 'dialog-danger'> = {
  forcePush: 'dialog',
  rebase: 'dialog',
  queue: 'dialog-danger',
  changeBase: 'dialog',
  abortRebase: 'dialog-danger',
  seeLog: 'dialog',
  takeOver: 'dialog-danger',
  seeError: 'dialog-danger',
  start: 'dialog',
};
const TESTID: Record<BranchAction['kind'], string> = {
  forcePush: 'ade-force-push',
  rebase: 'ade-rebase',
  queue: 'ade-queue-after',
  changeBase: 'ade-change-base',
  abortRebase: 'ade-abort-rebase',
  seeLog: 'ade-see-log',
  takeOver: 'ade-take-over',
  seeError: 'ade-see-error',
  start: 'ade-start',
};
</script>

<template>
  <div
    class="flex min-w-0 items-center justify-end gap-1.5"
    :class="tall ? 'h-board-row-tall' : 'h-board-row'"
    data-testid="ade-action-cell"
  >
    <AdeBranchTip v-if="row" :row="row" :color="color ?? null">
      <AdeChip
        :label="label"
        :tone="tag.tone"
        class="max-w-30 shrink truncate"
        data-testid="ade-tag"
      />
    </AdeBranchTip>
    <AdeTip v-else :text="tag.tip" :parts="tag.tipParts">
      <AdeChip
        :label="label"
        :tone="tag.tone"
        class="max-w-30 shrink truncate"
        data-testid="ade-tag"
      />
    </AdeTip>
    <AdeTip v-for="a in actions" :key="a.act?.id ?? a.kind" :text="a.tip" :parts="a.tipParts">
      <TooltipDisabledTrigger :disabled="a.disabled === true">
        <Button
          :variant="ACTION_VARIANT[a.kind]"
          size="kira-lg"
          class="shrink-0"
          :disabled="a.disabled"
          :data-testid="TESTID[a.kind]"
          @click.stop="emit('act', a)"
        >
          {{ a.label }}
        </Button>
      </TooltipDisabledTrigger>
    </AdeTip>
    <slot />
  </div>
</template>
