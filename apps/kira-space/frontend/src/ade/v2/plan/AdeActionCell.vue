<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { type BranchAction, type Tone, tagLabel } from '../board/actions';
import { actionStyle, solidStyle, tagStyle } from '../tones';
import { usePlanModel } from './usePlanModel';

// One cell of the left action column: the derived tag and, for a branch, its action buttons.
const props = defineProps<{
  tag: { label: string; tone: Tone; tip: string; since?: number };
  tall?: boolean;
  actions?: readonly BranchAction[];
  /** The branch is being rebased: its Rebase button reads `Rebasing…` and is disabled. */
  rebasing?: boolean;
}>();
const { liveNow } = usePlanModel();
const label = computed(() => tagLabel(props.tag, liveNow.value.getTime()));
const emit = defineEmits<{ act: [action: BranchAction] }>();

const STYLE: Record<BranchAction['kind'], () => Record<string, string>> = {
  forcePush: () => solidStyle('amber'),
  rebase: () => solidStyle('amber'),
  queueAfter: () => solidStyle('red'),
  seeError: () => solidStyle('red'),
  start: () => actionStyle('claude'),
};
const TESTID: Record<BranchAction['kind'], string> = {
  forcePush: 'ade-force-push',
  rebase: 'ade-rebase',
  queueAfter: 'ade-queue-after',
  seeError: 'ade-see-error',
  start: 'ade-start',
};
</script>

<template>
  <div
    class="flex min-w-0 items-center justify-end gap-1.5"
    :class="tall ? 'h-[68px]' : 'h-10'"
    data-testid="ade-action-cell"
  >
    <AdeTip :text="tag.tip">
      <span
        class="box-border max-w-30 shrink truncate rounded-kira-sm px-[7px] py-0.5 text-kira-sm font-semibold"
        :style="tagStyle(tag.tone)"
        data-testid="ade-tag"
        >{{ label }}</span
      >
    </AdeTip>
    <AdeTip v-for="a in actions" :key="a.kind" :text="a.tip">
      <Button
        size="xs"
        class="h-[22px] shrink-0 rounded-kira-sm px-[9px] text-kira-sm font-semibold"
        :style="STYLE[a.kind]()"
        :disabled="a.kind === 'rebase' && rebasing"
        :data-testid="TESTID[a.kind]"
        @click.stop="emit('act', a)"
      >
        {{ a.kind === 'rebase' && rebasing ? 'Rebasing…' : a.label }}
      </Button>
    </AdeTip>
    <slot />
  </div>
</template>
