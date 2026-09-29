<script setup lang="ts">
import { useElementByPoint, useMouse } from '@vueuse/core';
import { computed, watchEffect } from 'vue';
import AdeDayBand from './AdeDayBand.vue';
import AdeDayControls from './AdeDayControls.vue';
import AdeHistoryPull from './AdeHistoryPull.vue';
import { useAdeDragStore } from './state/adeDrag';
import { type DropTarget, dropVerdict, type SetPlanArgs } from './timelineOps';
import type { QueueBand, QueueSegment, QueueSpan, QueueView } from './useQueue';
import type { DropResult } from './useTimelineDrag';
import type { AdePlan } from './wire';

// P129 Part 5 §2.7: the timeline surface — one band per day, in order, the pull row (closed) above
// them and the Later day controls (§0.9) right above the Later band. The Add popover (commit 11)
// extends this component's own template further. `AdeRepoView` owns the scroll container,
// `historyOpen`/`historyReach` and every navigation function (§0.9) — this component only renders
// and bubbles intent up, **except** the drop dispatch below (§2.7 "one place"): `dropVerdict` is a
// pure routing decision over `view`/`plan`, not a mutation, so it lives here rather than forcing
// `plan`/`today` all the way back up just to recompute the same verdict in `AdeRepoView`. The actual
// store writes (`applyPlan`/opening the Move dialog) are still emitted up, same as every other action.
const props = defineProps<{
  view: QueueView;
  plan: AdePlan;
  today: string;
  historyOpen: boolean;
  pull: number;
  pct: number;
  historyDays: number;
  minExtraDate: string;
  /** P136: stack roots to render, `null` shows every stack. */
  visibleRoots: ReadonlySet<string> | null;
}>();

type SegmentActionType = NonNullable<QueueSegment['action']>;
type CellActionType = NonNullable<QueueSegment['cells'][number]['action']>;

const emit = defineEmits<{
  select: [id: string];
  /** P129 Part 6 §0.21: bubbled from `AdeDayBand`, re-emitted with both arguments. */
  openSession: [itemId: string, sessionId: string];
  openHistory: [];
  moreWeek: [];
  pickDate: [iso: string];
  rollover: [band: QueueBand];
  overflowMove: [band: QueueBand];
  dayMenu: [band: QueueBand, ev: MouseEvent];
  segmentAction: [action: SegmentActionType];
  cellAction: [action: CellActionType];
  applyPlan: [args: SetPlanArgs];
  openMoveDialog: [args: { ids: string[]; before: string | null; day: number }];
}>();

const itemsById = computed(() => new Map(props.view.items.map((item) => [item.id, item])));

const blocksByDay = computed(() => {
  const m = new Map<number, QueueSegment[]>();
  for (const seg of props.view.segments) {
    if (props.visibleRoots && !props.visibleRoots.has(seg.stackRoot)) continue;
    const arr = m.get(seg.day);
    if (arr) arr.push(seg);
    else m.set(seg.day, [seg]);
  }
  return m;
});

function spansFor(band: QueueBand): QueueSpan[] {
  const roots = props.visibleRoots;
  return roots ? band.spans.filter((s) => roots.has(s.stackRoot)) : band.spans;
}

// §0.12: while a drag is active, resolve the element under the pointer into a `DropTarget` — closest
// `[data-ade-box]` first (drop-on-box, mockup semantics: before its own lead), else closest
// `[data-ade-band]` (empty-day space: append). Runs continuously (VueUse's own reactive `x`/`y`), but
// only ever writes `adeDrag.target` while `adeDrag.ids` is set (`begin` already clears any stale
// target from a previous drag).
const adeDrag = useAdeDragStore();
const { x, y } = useMouse({ type: 'client' });
const { element } = useElementByPoint({ x, y });

function resolveDropTarget(el: HTMLElement | null): DropTarget | null {
  if (!el) return null;
  const box = el.closest<HTMLElement>('[data-ade-box]');
  if (box) {
    return { kind: 'box', lead: box.dataset.adeLead || null, day: Number(box.dataset.adeDay) };
  }
  const band = el.closest<HTMLElement>('[data-ade-band]');
  if (band) return { kind: 'band', day: Number(band.dataset.adeDay) };
  return null;
}

watchEffect(() => {
  if (!adeDrag.ids) return;
  adeDrag.setTarget(resolveDropTarget(element.value));
});

/** §0.12 highlight: the band under the current target, so long as a drag is actually in progress
 *  (`adeDrag.ids`) — a stale `target` from the drag that just ended must not highlight anything. */
const dragOverDay = computed(() => (adeDrag.ids && adeDrag.target ? adeDrag.target.day : null));

/** §0.13/§2.7: the one place `dropVerdict` runs — routes to a direct plan write or the Move dialog,
 *  same as the design's own dispatch pseudocode. */
function onDrop(result: NonNullable<DropResult>): void {
  const verdict = dropVerdict(props.view, props.plan, props.today, result.ids, result.target);
  if (verdict.kind === 'refuse') return;
  if (verdict.kind === 'direct') {
    emit('applyPlan', verdict.args);
    return;
  }
  emit('openMoveDialog', { ids: verdict.ids, before: verdict.before, day: verdict.day });
}
</script>

<template>
  <div data-testid="ade-timeline">
    <AdeHistoryPull
      v-if="!historyOpen"
      :pull="pull"
      :pct="pct"
      :history-count="view.historyCount"
      :history-days="historyDays"
      @open="emit('openHistory')"
    />
    <template v-for="band in view.bands" :key="band.day">
      <AdeDayControls
        v-if="band.isLater"
        :min-date="minExtraDate"
        @more-week="emit('moreWeek')"
        @pick-date="(iso) => emit('pickDate', iso)"
      />
      <AdeDayBand
        :band="band"
        :blocks="blocksByDay.get(band.day) ?? []"
        :spans="spansFor(band)"
        :items-by-id="itemsById"
        :parent-of="view.parentOf"
        :selected-id="view.selectedId"
        :drag-over="dragOverDay === band.day"
        @select="emit('select', $event)"
        @open-session="(itemId, sessionId) => emit('openSession', itemId, sessionId)"
        @rollover="emit('rollover', band)"
        @overflow-move="emit('overflowMove', band)"
        @day-menu="(ev) => emit('dayMenu', band, ev)"
        @segment-action="emit('segmentAction', $event)"
        @cell-action="emit('cellAction', $event)"
        @drop="onDrop"
      />
    </template>
  </div>
</template>
