<script setup lang="ts">
import { computed, ref } from 'vue';
import AdeContinuationRow from './AdeContinuationRow.vue';
import AdeStackBlock from './AdeStackBlock.vue';
import { TONE } from './tones';
import type { QueueBand, QueueItem, QueueSegment, QueueSpan } from './useQueue';
import type { DropResult } from './useTimelineDrag';
import { useTimelineDrag } from './useTimelineDrag';

// P129 Part 5 §0.22: one day band (mockup 1286-1301) — ruler, history rows, overdue/overflow
// strips, the day's own blocks, continuation rows, the day context menu. Every plan write this
// component's own buttons trigger is the caller's own (`AdeRepoView`, via `AdeTimeline`'s bubble):
// this component only emits intent, never reads `timelineOps.ts` or the plan itself. §0.12: the
// blocks column is the outer sortable's own root — one box list per band.
const props = defineProps<{
  band: QueueBand;
  blocks: QueueSegment[];
  /** P136: `band.spans` after the my-work cap, continuation rows to render. */
  spans: QueueSpan[];
  itemsById: ReadonlyMap<string, QueueItem>;
  parentOf: Readonly<Record<string, string>>;
  selectedId: string | null;
  /** §0.12 highlight: this band is the current drag's own hit-test target. The band itself still
   *  gates on `!isPast && !isDayOff` (mockup 1290's own "only when it accepts"). */
  dragOver: boolean;
}>();

type SegmentActionType = NonNullable<QueueSegment['action']>;
type CellActionType = NonNullable<QueueSegment['cells'][number]['action']>;

const emit = defineEmits<{
  select: [id: string];
  /** P129 Part 6 §0.21: bubbled from `AdeStackBlock`, re-emitted with both arguments. */
  openSession: [itemId: string, sessionId: string];
  rollover: [];
  overflowMove: [];
  dayMenu: [ev: MouseEvent];
  segmentAction: [action: SegmentActionType];
  cellAction: [action: CellActionType];
  drop: [result: NonNullable<DropResult>];
}>();

const blocksEl = ref<HTMLElement | null>(null);
useTimelineDrag(blocksEl, 'block', (result) => emit('drop', result));

const acceptsDrop = computed(() => !props.band.isPast && !props.band.isDayOff);
const showDragHighlight = computed(() => props.dragOver && acceptsDrop.value);

const greyed = computed(() => props.band.isWeekend || props.band.isDayOff);

const rowBorderClass = computed(() =>
  props.band.isMonday || props.band.isToday || props.band.isLater
    ? 'border-t border-t-border-strong'
    : 'border-t border-dashed border-t-border',
);

const rowBg = computed(() => {
  // §0.12: the drop highlight wins over every other band tint while it applies.
  if (showDragHighlight.value) return 'color-mix(in srgb, var(--kira-focus) 10%, transparent)';
  if (greyed.value) {
    return 'repeating-linear-gradient(135deg, color-mix(in srgb, var(--kira-fg) 2%, transparent) 0 6px, transparent 6px 12px)';
  }
  if (props.band.isOverdue) return 'rgba(232,163,61,0.04)';
  if (props.band.isPast) return 'color-mix(in srgb, var(--kira-fg) 1.5%, transparent)';
  return 'transparent';
});

const rulerBorderColor = computed(() => {
  if (props.band.isToday) return TONE.amber[2];
  if (props.band.isPast || greyed.value) return 'var(--kira-border)';
  return 'var(--kira-border-strong)';
});

const labelColor = computed(() => {
  if (greyed.value) return 'var(--kira-fg-subtle)';
  if (props.band.isOverdue) return TONE.amber[1];
  if (props.band.isEmpty || props.band.isPast) return 'var(--kira-fg-subtle)';
  return 'var(--kira-fg)';
});

const subColor = computed(() => {
  if (greyed.value) return 'var(--kira-fg-subtle)';
  if (props.band.hours > props.band.capacity && !props.band.isLater) return TONE.red[1];
  return 'var(--kira-fg-muted)';
});

const sub = computed(() => {
  if (props.band.isDayOff) return 'off';
  if (props.band.isWeekend && !props.band.hours) return '';
  return props.band.hours ? `${props.band.hours}h` : '';
});

const overdueNote = computed(
  () =>
    `${props.band.overdueStackCount} stack${props.band.overdueStackCount === 1 ? '' : 's'} not merged`,
);

const overflowNote = computed(() => {
  const over = Math.round((props.band.hours - props.band.capacity) * 10) / 10;
  return `${over}h over ${props.band.capacity}h`;
});

const tickColor = computed(() => (props.band.isToday ? TONE.amber[2] : 'var(--kira-bg)'));
</script>

<template>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only (§0.24) — the band holds
       nested interactive rows/buttons of its own, so it can't itself take a click/button role. -->
  <div
    class="flex"
    :class="[rowBorderClass, showDragHighlight ? 'outline outline-dashed outline-focus' : '']"
    :style="{ background: rowBg }"
    data-testid="ade-day-band"
    data-ade-band
    :data-ade-day="band.day"
    @contextmenu.prevent="emit('dayMenu', $event)"
  >
    <div
      class="relative box-border w-15 shrink-0 text-right"
      :class="band.isEmpty ? 'px-2.5 py-0.5' : 'py-1.5 pl-0 pr-2.5'"
      :style="{ borderRight: `2px solid ${rulerBorderColor}` }"
    >
      <span
        class="absolute top-2.5 rounded-full box-border"
        :class="band.isEmpty ? '-right-1 size-1.5' : '-right-1.5 size-2.5'"
        :style="{ background: tickColor, border: `2px solid ${rulerBorderColor}` }"
      />
      <div
        class="whitespace-nowrap"
        :class="[
          band.isEmpty ? 'text-kira-sm font-medium' : 'text-kira-md font-semibold',
          band.isDayOff ? 'line-through' : '',
        ]"
        :style="{ color: labelColor }"
      >
        {{ band.label }}
      </div>
      <div class="font-data text-kira-sm" :style="{ color: subColor }">{{ sub }}</div>
    </div>
    <div
      ref="blocksEl"
      class="flex min-w-0 flex-1 flex-col gap-1.5"
      :class="band.isEmpty ? (greyed ? 'min-h-4' : 'min-h-[22px]') : 'py-1.5 pl-2'"
    >
      <div
        v-for="h in band.history"
        :key="`${h.title}-${h.branch}`"
        class="ml-[218px] flex h-[30px] max-w-140 items-center gap-2 rounded-kira-sm bg-[rgba(163,113,247,0.06)] px-2.5 text-kira-sm text-muted-foreground"
      >
        <span class="font-bold text-[#c3a3fb]">✓</span>
        <span class="shrink-0 whitespace-nowrap text-kira-sm text-[#c3a3fb]">{{ h.how }}</span>
        <span class="min-w-0 truncate font-semibold text-fg">{{ h.title }}</span>
        <span class="min-w-0 truncate font-data text-kira-sm">{{ h.branch }}</span>
      </div>
      <div
        v-if="band.isOverdue"
        class="flex items-center gap-2 pl-[218px] text-kira-sm text-[#f0b85c]"
      >
        <span>{{ overdueNote }}</span>
        <button
          type="button"
          class="h-[22px] whitespace-nowrap rounded-kira-sm bg-[#e8a33d] px-2.5 text-kira-sm font-semibold text-[#15161a]"
          data-testid="ade-band-rollover"
          @click="emit('rollover')"
        >
          Move to today
        </button>
      </div>
      <div
        v-if="band.isOverflow && !greyed"
        class="flex items-center gap-2 pl-[218px] text-kira-sm text-[#f28b7d]"
      >
        <span>{{ overflowNote }}</span>
        <button
          type="button"
          class="h-[22px] max-w-90 truncate whitespace-nowrap rounded-kira-sm border border-[#ef6b5b] bg-transparent px-2.5 text-kira-sm font-semibold text-[#f28b7d]"
          data-testid="ade-band-overflow-move"
          @click="emit('overflowMove')"
        >
          {{ band.overflowMoveLabel }}
        </button>
      </div>
      <AdeStackBlock
        v-for="block in blocks"
        :key="`${block.stackRoot}-${block.root}`"
        :segment="block"
        :items-by-id="itemsById"
        :parent-of="parentOf"
        :selected-id="selectedId"
        @select="emit('select', $event)"
        @open-session="(itemId, sessionId) => emit('openSession', itemId, sessionId)"
        @segment-action="emit('segmentAction', $event)"
        @cell-action="emit('cellAction', $event)"
        @drop="emit('drop', $event)"
      />
      <AdeContinuationRow
        v-for="span in spans"
        :key="`${span.lead}-${span.startDay}`"
        :span="span"
        @pick="(lead) => emit('select', lead)"
      />
    </div>
  </div>
</template>
