<script setup lang="ts">
import AdeTip from '../AdeTip.vue';
import type { NeedsItem } from '../board/needsYou';
import { useNeedsAction } from '../needs/useNeedsAction';
import { solidStyle, TONE } from '../tones';

// The `!` circle: something here needs you. Click does the item's action: Take over a stuck run,
// open the waiting session.
const props = defineProps<{ tip: string; item?: NeedsItem | null }>();
const { perform, busy } = useNeedsAction();

function onClick(): void {
  if (props.item) void perform(props.item);
}
</script>

<template>
  <AdeTip :text="tip">
    <button
      type="button"
      aria-label="Needs you"
      class="inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-full border-0 p-0 text-kira-sm font-extrabold"
      :style="{ ...solidStyle('amber'), boxShadow: `0 0 0 3px ${TONE.amber[0]}` }"
      :disabled="busy"
      data-testid="ade-attention"
      @click.stop="onClick"
      >!</button
    >
  </AdeTip>
</template>
