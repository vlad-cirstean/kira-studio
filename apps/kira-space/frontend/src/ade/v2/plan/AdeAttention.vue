<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import AdeTip from '../AdeTip.vue';
import type { NeedsItem } from '../board/needsYou';
import { useNeedsAction } from '../needs/useNeedsAction';
import { TONE_SOLID_CLASS } from '../tones';

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
    <Button
      type="button"
      variant="ghost"
      aria-label="Needs you"
      class="size-4.5 cursor-pointer rounded-full border-0 p-0 text-kira-sm font-extrabold shadow-[0_0_0_3px_var(--color-tone-amber-tint)]"
      :class="TONE_SOLID_CLASS.amber"
      :disabled="busy"
      data-testid="ade-attention"
      @click.stop="onClick"
      >!</Button
    >
  </AdeTip>
</template>
