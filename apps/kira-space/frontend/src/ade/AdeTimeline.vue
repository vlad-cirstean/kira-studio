<script setup lang="ts">
import { computed } from 'vue';
import AdeDayBand from './AdeDayBand.vue';
import AdeDayControls from './AdeDayControls.vue';
import AdeHistoryPull from './AdeHistoryPull.vue';
import type { QueueBand, QueueSegment, QueueView } from './useQueue';

// P129 Part 5 §2.7: the timeline surface — one band per day, in order, the pull row (closed) above
// them and the Later day controls (§0.9) right above the Later band. Drag and drop (commit 10) and
// the Add popover (commit 11) extend this component's own template further. `AdeRepoView` owns the
// scroll container, `historyOpen`/`historyReach` and every navigation function (§0.9) — this
// component only renders and bubbles intent up.
const props = defineProps<{
  view: QueueView;
  historyOpen: boolean;
  pull: number;
  pct: number;
  historyDays: number;
  minExtraDate: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  openHistory: [];
  moreWeek: [];
  pickDate: [iso: string];
  rollover: [band: QueueBand];
  overflowMove: [band: QueueBand];
  dayMenu: [band: QueueBand, ev: MouseEvent];
}>();

const itemsById = computed(() => new Map(props.view.items.map((item) => [item.id, item])));

const blocksByDay = computed(() => {
  const m = new Map<number, QueueSegment[]>();
  for (const seg of props.view.segments) {
    const arr = m.get(seg.day);
    if (arr) arr.push(seg);
    else m.set(seg.day, [seg]);
  }
  return m;
});
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
        :items-by-id="itemsById"
        :parent-of="view.parentOf"
        :selected-id="view.selectedId"
        @select="emit('select', $event)"
        @rollover="emit('rollover', band)"
        @overflow-move="emit('overflowMove', band)"
        @day-menu="(ev) => emit('dayMenu', band, ev)"
      />
    </template>
  </div>
</template>
