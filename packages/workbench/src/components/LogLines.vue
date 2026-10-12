<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import { cardVariants } from '@theme/components/ui/card';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { computed, useTemplateRef } from 'vue';
import { useFollowTail } from '../behaviour/followTail';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '../behaviour/virtualRows';

// The one log viewer (run logs, worktree setup): virtualized, follows the tail until the reader
// scrolls up. Callers own loading and fetching; `testid` keeps each caller's own locator ids.
export interface LogLine {
  id: string | number;
  text: string;
  stream: string;
}

const props = defineProps<{
  lines: readonly LogLine[];
  testid: string;
  error?: string;
  truncated?: boolean;
  maxHeight?: string;
}>();

const scrollEl = useTemplateRef<HTMLElement>('scrollEl');
const ESTIMATED_LINE_HEIGHT = 18;
const { virtualizer, virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => props.lines.length,
  rowHeight: () => ESTIMATED_LINE_HEIGHT,
  scrollElement: scrollEl,
});
useFollowTail(scrollEl, () => props.lines.length);

const style = computed(() => (props.maxHeight ? { maxHeight: props.maxHeight } : undefined));

function measure(el: unknown): void {
  if (el instanceof Element) virtualizer.value.measureElement(el);
}

function streamClass(stream: string): string {
  if (stream === 'stderr') return 'text-error';
  return stream === 'event' ? 'text-muted-foreground' : 'text-fg';
}
</script>

<template>
  <div
    ref="scrollEl"
    :class="cn(cardVariants(), 'min-h-0 flex-1 gap-0 overflow-auto font-data text-kira-sm leading-relaxed', !maxHeight && 'max-h-60')"
    :style="style"
    :data-testid="testid"
    @scroll.passive="onScroll"
  >
    <InlineState v-if="error" kind="error" :data-testid="`${testid}-error`">{{
      error
    }}</InlineState>
    <template v-else>
      <div v-if="truncated" class="text-subtle">{{ t('common.truncated.status') }}</div>
      <div v-if="lines.length === 0" class="text-subtle">{{ t('common.noOutput.emptyHint') }}</div>
      <div v-else class="relative w-full" :style="{ height: `${totalSize}px` }">
        <div
          v-for="item in virtualItems"
          :key="lines[item.index]?.id ?? item.key"
          :ref="measure"
          :data-index="item.index"
          :class="cn(VIRTUAL_ROW_CLASS, 'whitespace-pre-wrap break-words', streamClass(lines[item.index]?.stream ?? ''))"
          :style="{ transform: `translateY(${item.start}px)` }"
          :data-testid="`${testid}-line`"
          :data-stream="lines[item.index]?.stream"
          >{{
            lines[item.index]?.text.replace(/\n$/, '')
          }}</div
        >
      </div>
    </template>
  </div>
</template>
