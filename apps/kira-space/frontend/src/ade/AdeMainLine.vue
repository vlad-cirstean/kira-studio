<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';

// P129 Part 3 §0.17/§2.7: mockup lines 96-105's own geometry (60px ruler gutter, 218px offset, a
// 560px-max 30px pill) — kept exact so Part 4's "Rebase all" button and Part 5's timeline slot into
// the same row/gutter without a relayout. P129 Part 4 §0.20/§2.7 adds the button itself, the one
// in-part opener (§0.8) — every other opener's first UI caller is a later row.
const props = defineProps<{
  mainName: string | null;
  behindCount: number;
  /** §0.20: `view.behindRoots.length > 0 && rebasingFor(repo).size === 0` — this component stays
   *  ignorant of `useQueue`/`adeActions`, the caller already knows both. */
  canRebaseAll: boolean;
}>();

const emit = defineEmits<{ rebaseAll: [] }>();

const note = computed(() => {
  if (props.mainName === null) return 'no main branch';
  return props.behindCount > 0
    ? `${props.behindCount} stack${props.behindCount === 1 ? '' : 's'} behind`
    : 'all stacks current';
});

// Tones are literal tints (design §2.1/2.7), matching the mockup's own mainNoteStyle exactly —
// "no main branch" is neutral, not a tone, so it stays on a theme token.
const noteClass = computed(() => {
  if (props.mainName === null) return 'text-muted-foreground';
  return props.behindCount > 0 ? 'text-[#f0b85c]' : 'text-[#7fd49b]';
});
</script>

<template>
  <div class="flex" data-testid="ade-main-line">
    <div class="w-15 shrink-0 border-r-2 border-border-strong" />
    <div class="flex min-w-0 flex-1 gap-2 pb-2 pl-[218px]">
      <div
        class="flex h-[30px] min-w-0 max-w-140 flex-1 items-center gap-2.5 rounded-kira border border-border bg-elevated px-3"
      >
        <span class="font-data text-kira-sm font-semibold" data-testid="ade-main-name">{{
          mainName ?? ''
        }}</span>
        <span class="whitespace-nowrap text-kira-sm" :class="noteClass" data-testid="ade-main-note">{{
          note
        }}</span>
        <Button
          v-if="canRebaseAll"
          variant="dialog"
          size="sm"
          class="ml-auto shrink-0 border-none bg-[#e8a33d] text-[#15161a] hover:bg-[#e8a33d]/80"
          data-testid="ade-rebase-all"
          @click="emit('rebaseAll')"
        >
          Rebase all
        </Button>
      </div>
    </div>
  </div>
</template>
