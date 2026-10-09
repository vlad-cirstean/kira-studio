<script setup lang="ts">
/**
 * §5.1.1's explicit "load more" affordance — pages of `pageSize` rows, never infinite scroll.
 * A plain click calls `graphView.loadMore()`; an Alt/Option-click ("do the bigger thing", the
 * workbench's own modifier convention) calls `graphView.loadAll()` instead. Both share one
 * `loading` state on `GraphViewState`, so a second press while either is in flight is a no-op —
 * the native `disabled` attribute plus the `loading` guard in `handlePress` cover it twice.
 *
 * Deliberately has no live region of its own: W14 owns "one polite live region" announcing both
 * load-more and refresh outcomes, and a second region here would fight it (plan lines ~1325-6).
 */
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import type { GraphViewState } from '../state/graphView.ts';

const props = defineProps<{
  graphView: GraphViewState;
  pageSize: number;
  reportError: (err: unknown, prefix: string) => void;
}>();

const formatter = new Intl.NumberFormat();

function fmt(n: number): string {
  return formatter.format(n);
}

const isLoading = computed(() => props.graphView.loading.value !== 'idle');

const buttonLabel = computed(() => {
  const remaining = props.graphView.remaining.value;
  if (isLoading.value) {
    return `Loading… (${fmt(remaining)} remaining)`;
  }
  if (remaining < props.pageSize) {
    return `Load the last ${fmt(remaining)}`;
  }
  return `Load ${fmt(props.pageSize)} more (${fmt(remaining)} remaining)`;
});

function handlePress(event: MouseEvent): void {
  if (isLoading.value) return;
  const load = event.altKey ? props.graphView.loadAll() : props.graphView.loadMore();
  load.catch((err: unknown) => props.reportError(err, "Couldn't load more history"));
}

function handleCancel(): void {
  props.graphView.cancelLoad();
}
</script>

<template>
  <!-- G16 D9: `remaining > 0` guards against F7's zero-chunk hole — a re-stream that emits no
       chunk leaves no server-side signal to correct, so this is the one place that hole can be
       closed. Kept visible while a load is in flight (`isLoading`) so Cancel does not vanish
       mid-load. -->
  <div
    v-if="!graphView.exhausted.value && (isLoading || graphView.remaining.value > 0)"
    class="flex items-center justify-center gap-1 py-1 px-2 shrink-0"
  >
    <Tooltip>
      <TooltipTrigger as-child>
        <Button variant="toolbar" size="kira" :disabled="isLoading" @click="handlePress">
          {{ buttonLabel }}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Alt-click to load everything remaining — this keeps every loaded commit in memory.
      </TooltipContent>
    </Tooltip>
    <!-- G34: the toolbar Button box already matches this shape; Cancel keeps its one genuine
         distinction, the underline. -->
    <Button
      v-if="isLoading"
      variant="toolbar"
      size="kira"
      class="underline"
      aria-label="Cancel loading"
      @click="handleCancel"
    >
      Cancel
    </Button>
  </div>
</template>
