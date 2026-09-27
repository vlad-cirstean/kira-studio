<script setup lang="ts">
import { computed } from 'vue';
import AdeDayBand from './AdeDayBand.vue';
import type { QueueSegment, QueueView } from './useQueue';

// P129 Part 5 §2.7: the timeline surface — one band per day, in order. Read-only apart from
// selection this commit (§4 step 6): the pull row (`AdeHistoryPull`), history bar, Later day
// controls (commit 7), drag and drop (commit 10) and the Add popover (commit 11) all land on this
// component in later commits, extending its own template rather than replacing it.
const props = defineProps<{ view: QueueView }>();

const emit = defineEmits<{ select: [id: string] }>();

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
    <AdeDayBand
      v-for="band in view.bands"
      :key="band.day"
      :band="band"
      :blocks="blocksByDay.get(band.day) ?? []"
      :items-by-id="itemsById"
      :parent-of="view.parentOf"
      :selected-id="view.selectedId"
      @select="emit('select', $event)"
    />
  </div>
</template>
