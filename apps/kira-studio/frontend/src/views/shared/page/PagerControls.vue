<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
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
  <div class="group pager" :data-testid="`${testidPrefix}pager`" :data-pagination="strategy">
    <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="First page"
            :data-testid="`${testidPrefix}pager-first`"
            :disabled="pageIndex === 0"
            @click="emit('first')"
          >
            <CodiconIcon name="chevron-left" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>First page</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Previous page"
            :data-testid="`${testidPrefix}pager-prev`"
            :disabled="pageIndex === 0"
            @click="emit('prev')"
          >
            <CodiconIcon name="arrow-left" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Previous page</TooltipContent>
    </Tooltip>
    <span class="page-label p-sm muted">
      page
      <div class="page-input">
        <Input
          v-model="pageInputValue"
          type="number"
          min="1"
          class="h-control w-full text-center"
          :data-testid="`${testidPrefix}pager-page-input`"
          @change="onJump"
        />
      </div>
      <template v-if="pageCount"> of {{ pageCount }}</template>
    </span>
    <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Next page"
            :data-testid="`${testidPrefix}pager-next`"
            :disabled="!hasMore"
            @click="emit('next')"
          >
            <CodiconIcon name="arrow-right" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Next page</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :aria-describedby="undefined">
          <Button
            variant="toolbar"
            size="kira-icon"
            aria-label="Last page"
            :data-testid="`${testidPrefix}pager-last`"
            :disabled="!pageCount"
            @click="emit('last')"
          >
            <CodiconIcon name="chevron-right" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ pageCount ? 'Last page' : lastTooltip }}</TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.pager {
  @apply gap-0.5;
}

.page-label {
  @apply inline-flex items-center whitespace-nowrap gap-0.5;
}

.page-input {
  @apply w-12;
}

.page-input :deep(input) {
  @apply px-1;
}

/* P22 D2: F3 shows the page-number box is already the same 22px height as the icon buttons
   beside it — the complaint's real cause is visual weight, a bordered/filled box in a row of
   transparent icon buttons. At rest this drops the fill/border so all five pager controls read
   as one weight; :focus/:hover restore both, the same "engaged control" idiom .p-select
   (borderless by default, .bordered opt-in) already uses. */
.page-input :deep(input:not(:focus):not(:hover)) {
  @apply bg-none border-transparent;
}
</style>
