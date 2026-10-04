<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import AdeTip from '../AdeTip.vue';
import type { Tone } from '../board/actions';
import { solidStyle, tagStyle } from '../tones';

// One cell of the left action column: the derived tag and, for a branch, its Force push button.
// Rebase, Queue after and Start are not offered here (they land with their dialogs and methods).
defineProps<{
  tag: { label: string; tone: Tone; tip: string };
  tall?: boolean;
  forcePush?: { label: string; tip: string };
}>();
const emit = defineEmits<{ forcePush: [] }>();
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
        >{{ tag.label }}</span
      >
    </AdeTip>
    <AdeTip v-if="forcePush" :text="forcePush.tip">
      <Button
        size="xs"
        class="h-[22px] shrink-0 rounded-kira-sm px-[9px] text-kira-sm font-semibold"
        :style="solidStyle('amber')"
        data-testid="ade-force-push"
        @click="emit('forcePush')"
      >
        {{ forcePush.label }}
      </Button>
    </AdeTip>
  </div>
</template>
