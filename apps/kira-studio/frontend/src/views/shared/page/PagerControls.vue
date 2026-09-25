<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Input } from '@theme/components/ui/input';
import { computed, ref, watch } from 'vue';

// P48 F4: the first/prev/page-jump/next/last pager DataToolbar.vue and DocumentView.vue each
// wrote out — same five controls, same order, same pageDisplay/pageInputValue/pageCount/onJump
// computeds, differing only in their data-testid prefix and the "count first" tooltip's noun.
// D7: uses the document view's own icon spelling (arrow-left/arrow-right for prev/next) — the
// grid's own chevron-left/chevron-right pair for First and Previous rendered two identical
// glyphs side by side, which this fixes by construction.
const props = defineProps<{
  pageIndex: number;
  pageSize: number;
  count: number | null;
  hasMore: boolean;
  testidPrefix: string;
  lastTooltip: string;
  strategy?: string;
}>();

const emit = defineEmits<{ first: []; prev: []; next: []; last: []; jump: [pageIndex: number] }>();

const pageDisplay = computed(() => props.pageIndex + 1);

// A plain `:value="pageDisplay"` fights the user's typing: any unrelated reactive read this
// component makes forces a re-render, and Vue reasserts the bound value on the DOM input
// regardless of whether pageDisplay itself changed — wiping out whatever the user has typed but
// not yet committed. Mirroring it through its own ref, kept in sync with pageDisplay only when
// the page actually advances, avoids the fight.
const pageInputValue = ref(String(pageDisplay.value));
watch(pageDisplay, (v) => {
  pageInputValue.value = String(v);
});

const pageCount = computed(() => {
  if (props.count === null || !props.pageSize) return null;
  return Math.max(1, Math.ceil(props.count / props.pageSize));
});

// P21 round 3 functional finding 12: a rejected jump (non-numeric, or < 1) used to leave
// pageInputValue exactly as the user left it forever — the box's own resync only ever runs off
// `watch(pageDisplay, ...)` above, which fires only when the page actually changes, so a rejected
// jump (nothing changes) never touched it. And a jump past the last known page was never clamped
// here at all (state.ts's own goToPage only clamps at 0), so typing e.g. 99 against a 3-page
// result silently asked for an offset far past the end.
function onJump(e: Event): void {
  const value = Number((e.target as HTMLInputElement).value);
  const valid = Number.isFinite(value) && value >= 1;
  if (!valid) {
    // Resync to the actual current page rather than leaving the box permanently out of sync with
    // what the grid is really showing.
    pageInputValue.value = String(pageDisplay.value);
    return;
  }
  const target = pageCount.value !== null ? Math.min(value, pageCount.value) : value;
  emit('jump', target - 1);
  // Reflect a clamp immediately rather than waiting on the parent to round-trip pageIndex back
  // through the pageDisplay watcher — an unclamped jump doesn't need this, since that watcher
  // already fires once the new pageIndex prop lands.
  if (target !== value) pageInputValue.value = String(target);
}
</script>

<template>
  <div class="group gap-0.5" :data-testid="`${testidPrefix}pager`" :data-pagination="strategy">
    <TooltipIconButton
      icon="chevron-left"
      label="First page"
      disabled-trigger
      :data-testid="`${testidPrefix}pager-first`"
      :disabled="pageIndex === 0"
      @click="emit('first')"
    />
    <TooltipIconButton
      icon="arrow-left"
      label="Previous page"
      disabled-trigger
      :data-testid="`${testidPrefix}pager-prev`"
      :disabled="pageIndex === 0"
      @click="emit('prev')"
    />
    <span class="inline-flex items-center whitespace-nowrap gap-0.5 text-kira-sm text-muted-foreground">
      page
      <div class="w-12">
        <!-- P22 D2: F3 shows the page-number box is already the same 22px height as the icon
             buttons beside it — the complaint's real cause is visual weight, a bordered/filled box
             in a row of transparent icon buttons. At rest this drops the fill/border so all five
             pager controls read as one weight; :focus/:hover restore both, the same "engaged
             control" idiom NativeSelect (borderless default variant, bordered opt-in) already
             uses. P110 B25: the `:deep(input)` class props above move directly onto <Input> —
             `not-focus:`/`not-hover:` (Tailwind's own built-in variants) replace the old
             `:not(:focus):not(:hover)` compound selector. -->
        <Input
          v-model="pageInputValue"
          type="number"
          min="1"
          class="h-control w-full px-1 text-center not-focus:not-hover:border-transparent not-focus:not-hover:bg-none"
          :data-testid="`${testidPrefix}pager-page-input`"
          @change="onJump"
        />
      </div>
      <template v-if="pageCount"> of {{ pageCount }}</template>
    </span>
    <TooltipIconButton
      icon="arrow-right"
      label="Next page"
      disabled-trigger
      :data-testid="`${testidPrefix}pager-next`"
      :disabled="!hasMore"
      @click="emit('next')"
    />
    <TooltipIconButton
      icon="chevron-right"
      :label="pageCount ? 'Last page' : lastTooltip"
      aria-label="Last page"
      disabled-trigger
      :data-testid="`${testidPrefix}pager-last`"
      :disabled="!pageCount"
      @click="emit('last')"
    />
  </div>
</template>
