<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { TooltipDisabledTrigger } from '@theme/components/ui/tooltip';
import type { TextPart } from '@theme/varText';
import { computed } from 'vue';
import AdeTip from '../AdeTip.vue';
import { type BranchAction, type Tone, tagLabel } from '../board/actions';
import { ACTION_CLASS, TONE_SOLID_CLASS, TONE_TAG_CLASS } from '../tones';
import { usePlanModel } from './usePlanModel';

// One cell of the left action column: the derived tag and, for a branch, its action buttons.
const props = defineProps<{
  tag: { label: string; tone: Tone; tip: string; tipParts?: readonly TextPart[]; since?: number };
  tall?: boolean;
  actions?: readonly BranchAction[];
}>();
const { liveNow } = usePlanModel();
const label = computed(() => tagLabel(props.tag, liveNow.value.getTime()));
const emit = defineEmits<{ act: [action: BranchAction] }>();

const ACTION_BTN_CLASS: Record<BranchAction['kind'], string> = {
  forcePush: TONE_SOLID_CLASS.amber,
  rebase: TONE_SOLID_CLASS.amber,
  queue: TONE_SOLID_CLASS.red,
  changeBase: TONE_SOLID_CLASS.amber,
  abortRebase: TONE_SOLID_CLASS.red,
  seeLog: TONE_SOLID_CLASS.amber,
  takeOver: TONE_SOLID_CLASS.red,
  seeError: TONE_SOLID_CLASS.red,
  start: ACTION_CLASS.claude,
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
    :class="tall ? 'h-17' : 'h-10'"
    data-testid="ade-action-cell"
  >
    <AdeTip :text="tag.tip" :parts="tag.tipParts">
      <span
        class="box-border max-w-30 shrink truncate rounded-kira-sm px-1.5 py-0.5 text-kira-sm font-semibold"
        :class="TONE_TAG_CLASS[tag.tone]"
        data-testid="ade-tag"
        >{{ label }}</span
      >
    </AdeTip>
    <AdeTip v-for="a in actions" :key="a.act?.id ?? a.kind" :text="a.tip" :parts="a.tipParts">
      <TooltipDisabledTrigger :disabled="a.disabled === true">
        <Button
          size="kira-lg"
          class="shrink-0 font-semibold"
          :class="ACTION_BTN_CLASS[a.kind]"
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
