<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { FieldDescription } from '@theme/components/ui/field';
import { Separator } from '@theme/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
// The one attribute-driven tooltip residue. SlickGridHost.vue/ConsoleSlickGrid.vue put
// `data-kira-tip`/`data-kira-tip-parts` into SlickGrid's own `headerCellAttrs` -- a static bag on
// DOM SlickGrid creates, not Vue, so no `TooltipTrigger` can wrap a header cell. This drives the
// same reka TooltipRoot context a real trigger would, by hand: a `pointermove` listener scoped to
// the grid's own header row (never `document`) resolves the hovered `[data-kira-tip]` cell with
// `closest()`, then calls the imperative `onTriggerEnter()`/`onTriggerLeave()` TooltipAnchorBridge
// exposes. Delay/rearm timing still comes entirely from TooltipProvider -- only "which element is
// hovered" is app code, and only because SlickGrid owns that DOM (this bridge is the
// exception, not a general replacement for the real Tooltip/TooltipTrigger/TooltipContent trio
// every other call site converts to).
import { useEventListener } from '@vueuse/core';
import { computed, ref } from 'vue';
import TooltipAnchorBridge from './TooltipAnchorBridge.vue';

/** The structured half of a tooltip — carried in a second attribute (`data-kira-tip-
 *  parts`, this file's own `PARTS_ATTR`) so `data-kira-tip` itself stays the exact newline-joined
 *  plain text it always was (the a11y mirror, and every existing Playwright assertion). A plain
 *  string tooltip never sets this at all. */
interface TooltipContentShape {
  title: string;
  meta?: string;
  /** The data-type badge's own colour (columnTypeColor, theme/icons.ts) — the only caller of
   *  `meta` today is a column-type hint, and the badge is what carries the colour visibly rather
   *  than the plain a11y text these get joined into, so this never affects it. */
  metaColor?: string;
  /** Short fact chips, already translated. */
  tags?: string[];
  body?: string;
  /** A labelled block below a separator, e.g. a DB comment. Label already translated. */
  note?: { label: string; text: string };
}

const TIP_ATTR = 'data-kira-tip';
const PARTS_ATTR = 'data-kira-tip-parts';

const props = defineProps<{
  /** The grid's own header row element(s). Scoping the listener to them (instead of `document`)
   *  keeps this mountable twice (SlickGridHost.vue and ConsoleSlickGrid.vue each own a grid) with
   *  no cross-talk, and matches how little of `document`-level hit-testing state/tooltip.ts's
   *  comment needed in the first place -- SlickGrid's header row is the only DOM this ever hits.
   *  An array, not a single element: SlickGrid always splits the header row into two sibling DOM
   *  panes (frozen columns + the rest), with no narrower common ancestor than the whole grid --
   *  `useEventListener` takes `Arrayable<HTMLElement>` natively, so the caller passes both. */
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

// P131 Part 2 §3.2: a focusable row/checkbox behind a data-kira-tip attribute (git-ui's list
// rows, FileTree's checkboxes) opens its tip on keyboard focus too, matching reka's real
// TooltipTrigger (which opens on focus with no hover delay).
function onFocusIn(e: FocusEvent): void {
  const el = (e.target as HTMLElement | null)?.closest<HTMLElement>(`[${TIP_ATTR}]`) ?? null;
  if (!el) return;
  enter(el);
  bridge.value?.onOpen();
}

function onFocusOut(e: FocusEvent): void {
  const related = e.relatedTarget as Node | null;
  if (hoveredEl.value && (!related || !hoveredEl.value.contains(related))) leave();
}

const containerRef = computed(() => props.container);
useEventListener(containerRef, 'pointermove', onPointerMove, { passive: true });
useEventListener(containerRef, 'pointerleave', leave);
useEventListener(containerRef, 'focusin', onFocusIn);
useEventListener(containerRef, 'focusout', onFocusOut);
</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <!-- reka's raw PopperAnchor (what a `reference` point normally anchors through, per
           ContextMenu.vue's own precedent) is not a public export -- TooltipTrigger's own
           `reference` prop is the public seam that reaches the same PopperAnchor internally, so
           this inert 0x0 span only ever donates its `reference` override; nobody hovers it. -->
      <TooltipTrigger as-child :reference="hoveredEl ?? undefined">
        <span aria-hidden="true" class="pointer-events-none fixed size-0" />
      </TooltipTrigger>
      <TooltipAnchorBridge ref="bridge" />
      <TooltipContent>
        <div v-if="parts" class="flex flex-col items-stretch gap-1.5 py-1">
          <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5" data-testid="tooltip-header">
            <span class="font-data font-medium wrap-anywhere" data-testid="tooltip-title">{{
              parts.title
            }}</span>
            <span
              v-if="parts.meta"
              class="font-data text-kira-sm"
              data-testid="tooltip-meta"
              :style="parts.metaColor ? { color: parts.metaColor } : undefined"
              >{{
                parts.meta
              }}</span
            >
          </div>
          <div v-if="parts.tags?.length" class="flex flex-wrap gap-1" data-testid="tooltip-tags">
            <Badge
              v-for="tag in parts.tags"
              :key="tag"
              variant="chip"
              data
              class="h-auto border border-border text-kira-sm"
              data-testid="tooltip-tag"
              >{{
                tag
              }}</Badge
            >
          </div>
          <FieldDescription v-if="parts.body" data-testid="tooltip-body">{{
            parts.body
          }}</FieldDescription>
          <template v-if="parts.note">
            <Separator />
            <div class="flex flex-col gap-0.5" data-testid="tooltip-note">
              <span
                class="text-kira-sm font-medium text-muted-foreground"
                data-testid="tooltip-note-label"
                >{{
                  parts.note.label
                }}</span
              >
              <p class="text-kira-sm wrap-anywhere" data-testid="tooltip-note-text">{{
                parts.note.text
              }}</p>
            </div>
          </template>
        </div>
        <template v-else>{{ plainText }}</template>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
