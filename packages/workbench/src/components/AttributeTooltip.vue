<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@theme/components/ui/tooltip';
// P104 §6.4: the one attribute-driven tooltip residue. SlickGridHost.vue/ConsoleSlickGrid.vue put
// `data-kira-tip`/`data-kira-tip-parts` into SlickGrid's own `headerCellAttrs` -- a static bag on
// DOM SlickGrid creates, not Vue, so no `TooltipTrigger` can wrap a header cell. This drives the
// same reka TooltipRoot context a real trigger would, by hand: a `pointermove` listener scoped to
// the grid's own header row (never `document`) resolves the hovered `[data-kira-tip]` cell with
// `closest()`, then calls the imperative `onTriggerEnter()`/`onTriggerLeave()` TooltipAnchorBridge
// exposes. Delay/rearm timing still comes entirely from TooltipProvider -- only "which element is
// hovered" is app code, and only because SlickGrid owns that DOM (§6.6: this bridge is the
// exception, not a general replacement for the real Tooltip/TooltipTrigger/TooltipContent trio
// every other call site converts to).
import { useEventListener } from '@vueuse/core';
import { computed, ref } from 'vue';
import type { TooltipContent as TooltipContentShape } from '../state/tooltip';
import TooltipAnchorBridge from './TooltipAnchorBridge.vue';

const TIP_ATTR = 'data-kira-tip';
const PARTS_ATTR = 'data-kira-tip-parts';

const props = defineProps<{
  /** The grid's own header row element(s). Scoping the listener to them (instead of `document`)
   *  keeps this mountable twice (SlickGridHost.vue and ConsoleSlickGrid.vue each own a grid) with
   *  no cross-talk, and matches how little of `document`-level hit-testing state/tooltip.ts's D3
   *  comment needed in the first place -- SlickGrid's header row is the only DOM this ever hits.
   *  An array, not a single element: SlickGrid always splits the header row into two sibling DOM
   *  panes (frozen columns + the rest), with no narrower common ancestor than the whole grid --
   *  `useEventListener` takes `Arrayable<HTMLElement>` natively, so the caller just passes both. */
  container: HTMLElement[] | HTMLElement | null;
}>();

const bridge = ref<InstanceType<typeof TooltipAnchorBridge> | null>(null);
const hoveredEl = ref<HTMLElement | null>(null);

function readParts(el: HTMLElement): TooltipContentShape | null {
  const raw = el.getAttribute(PARTS_ATTR);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TooltipContentShape;
  } catch {
    return null;
  }
}

const plainText = computed(() => hoveredEl.value?.getAttribute(TIP_ATTR) ?? '');
const parts = computed(() => (hoveredEl.value ? readParts(hoveredEl.value) : null));

function leave(): void {
  if (!hoveredEl.value) return;
  hoveredEl.value.removeAttribute('aria-describedby');
  bridge.value?.onTriggerLeave();
  hoveredEl.value = null;
  bridge.value?.onTriggerChange(undefined);
}

function enter(el: HTMLElement): void {
  if (el === hoveredEl.value) return;
  leave();
  hoveredEl.value = el;
  bridge.value?.onTriggerChange(el);
  bridge.value?.onTriggerEnter();
  const id = bridge.value?.contentId;
  if (id) el.setAttribute('aria-describedby', id);
}

function onPointerMove(e: PointerEvent): void {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  if (el) enter(el);
  else leave();
}

const containerRef = computed(() => props.container);
useEventListener(containerRef, 'pointermove', onPointerMove, { passive: true });
useEventListener(containerRef, 'pointerleave', leave);
</script>

<template>
  <TooltipProvider :delay-duration="400" :skip-delay-duration="300" disable-hoverable-content>
    <Tooltip>
      <!-- reka's raw PopperAnchor (what a `reference` point normally anchors through, per
           ContextMenu.vue's own §5.2 precedent) is not a public export -- TooltipTrigger's own
           `reference` prop is the public seam that reaches the same PopperAnchor internally, so
           this inert 0x0 span only ever donates its `reference` override; nobody hovers it. -->
      <TooltipTrigger as-child :reference="hoveredEl ?? undefined">
        <span aria-hidden="true" class="pointer-events-none fixed size-0" />
      </TooltipTrigger>
      <TooltipAnchorBridge ref="bridge" />
      <TooltipContent>
        <template v-if="parts">
          <div class="flex items-baseline gap-1.5">
            <span class="font-semibold" data-testid="tooltip-title">{{ parts.title }}</span>
            <span
              v-if="parts.meta"
              data-testid="tooltip-meta"
              :style="parts.metaColor ? { color: parts.metaColor } : undefined"
              >{{ parts.meta }}</span
            >
          </div>
          <div v-if="parts.body" data-testid="tooltip-body">{{ parts.body }}</div>
        </template>
        <template v-else>{{ plainText }}</template>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
