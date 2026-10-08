<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import { computed, ref } from 'vue';
import { useDraggable } from 'vue-draggable-plus';
import type { TimelineBand } from '../board/timeline';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { TONE_SOLID_CLASS } from '../tones';
import AdeTaskCard from './AdeTaskCard.vue';
import type { BranchRowModel, CardModel } from './usePlanModel';

// One day of the timeline: ruler, history rows, overdue and overflow strips, the day's cards and
// the continuation rows of multi-day tasks. Plan writes are the parent's: this only emits intent.
const ui = useAdeBoardUiStore();
const props = defineProps<{
  band: TimelineBand;
  cards: CardModel[];
  /** Continuation rows: task title plus the span facts. */
  spans: { taskId: string; title: string; color: string; note: string; merges: boolean; tip: string }[];
  history: { key: string; how: string; repos: string; title: string }[];
  overdueNote: string;
  overflowNote: string;
  overflowLabel: string;
  dragOver: boolean;
}>();
const emit = defineEmits<{
  select: [taskId: string];
  rollover: [];
  overflowMove: [];
  dayMenu: [ev: MouseEvent];
  forcePush: [row: BranchRowModel];
  dragStart: [taskId: string];
  dragEnd: [];
}>();

// SortableJS only drags direct children of its list, so each band's drop area is its own list.
// `sort: false` and no group pull/put mean it never moves Vue-managed DOM; the parent resolves the
// drop target from the pointer instead.
const dropEl = ref<HTMLElement | null>(null);
useDraggable(dropEl, {
  draggable: '[data-ade-task]',
  sort: false,
  group: { name: 'ade-plan', pull: false, put: false },
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 4,
  ghostClass: 'opacity-40',
  chosenClass: 'ring-2',
  onStart: (evt) => emit('dragStart', evt.item.dataset.taskId ?? ''),
  onEnd: () => emit('dragEnd'),
});

const greyed = computed(() => props.band.weekend || props.band.dayOff);
const empty = computed(
  () => props.cards.length === 0 && props.spans.length === 0 && props.history.length === 0,
);
const overdue = computed(() => props.band.overdueTaskIds.length > 0);
const over = computed(() => props.band.overflowTaskIds.length > 0 && !greyed.value);
const accepts = computed(() => !props.band.isPast && !props.band.dayOff);
const highlight = computed(() => props.dragOver && accepts.value);

const rowBgClass = computed(() => {
  if (greyed.value) {
    return 'bg-[repeating-linear-gradient(135deg,color-mix(in_srgb,var(--kira-fg)_2%,transparent)_0_6px,transparent_6px_12px)]';
  }
  if (overdue.value) return 'bg-tone-amber-solid/4';
  return props.band.isPast ? 'bg-fg/2' : '';
});
const rulerBorderClass = computed(() => {
  if (props.band.isToday) return 'border-r-tone-amber-solid';
  return props.band.isPast || greyed.value ? 'border-r-border' : 'border-r-border-strong';
});
const dotClass = computed(() => {
  if (props.band.isToday) return 'border-tone-amber-solid bg-tone-amber-solid';
  return props.band.isPast || greyed.value ? 'border-border bg-bg' : 'border-border-strong bg-bg';
});
const labelClass = computed(() => {
  if (greyed.value) return 'text-disabled';
  if (overdue.value) return 'text-tone-amber';
  return empty.value || props.band.isPast ? 'text-subtle' : 'text-fg';
});
const subClass = computed(() => {
  if (greyed.value) return 'text-disabled';
  return props.band.overflowHours > 0 && !props.band.isLater ? 'text-tone-red' : 'text-muted-foreground';
});
const sub = computed(() => {
  if (props.band.dayOff) return 'off';
  return props.band.hours ? `${props.band.hours}h` : '';
});
const solidBorder = computed(
  () => props.band.isMonday || props.band.isLater || props.band.isToday,
);
</script>

<template>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: right-click only; the band holds nested interactive rows. -->
  <div
    class="flex border-t"
    :class="[solidBorder ? 'border-t-border-strong' : 'border-dashed border-t-border', rowBgClass]"
    data-testid="ade-day-band"
    data-ade-band
    :data-ade-day="band.key"
    @contextmenu.prevent="emit('dayMenu', $event)"
  >
    <div
      class="relative box-border w-15 shrink-0 border-r-2 text-right"
      :class="[empty ? 'px-2.5 py-0.5 pl-0' : 'py-1.5 pl-0 pr-2.5', rulerBorderClass]"
    >
      <span
        class="absolute box-border rounded-full border-2"
        :class="[empty ? '-right-1 top-1.5 size-1.5' : '-right-1.5 top-2.5 size-2.5', dotClass]"
      />
      <div
        class="whitespace-nowrap"
        :class="[empty ? 'text-kira-sm font-medium' : 'text-kira-md font-semibold', band.dayOff ? 'line-through' : '', labelClass]"
        data-testid="ade-band-label"
      >
        {{ band.label }}
      </div>
      <div class="text-kira-sm" :class="subClass">{{ sub }}</div>
    </div>
    <div
      class="box-border flex min-w-0 flex-1 flex-col gap-2.5 rounded-kira"
      :class="[
        empty ? (greyed ? 'min-h-4' : 'min-h-control') : 'pb-2.5 pl-2 pt-2',
        highlight ? 'outline outline-1 outline-dashed outline-focus bg-focus/10' : '',
      ]"
      ref="dropEl"
      data-testid="ade-band-drop"
    >
      <Button
        v-for="h in history"
        :key="h.key"
        variant="ghost"
        class="ml-54.5 h-row w-auto justify-start gap-2 bg-tone-purple-solid/6 px-2.5 font-normal text-muted-foreground"
        :data-selected="ui.selectedTaskId === h.key || undefined"
        data-testid="ade-history-row"
        @click="ui.select(h.key)"
      >
        <span class="font-bold text-tone-purple">✓</span>
        <span class="shrink-0 whitespace-nowrap text-kira-sm text-tone-purple">{{ h.how }}</span>
        <span class="shrink-0 whitespace-nowrap text-kira-sm text-muted-foreground">{{ h.repos }}</span>
        <span class="min-w-0 truncate font-semibold text-fg">{{ h.title }}</span>
      </Button>
      <div
        v-if="overdue"
        class="flex items-center gap-2 pl-54.5 text-kira-sm text-tone-amber"
      >
        <span>{{ overdueNote }}</span>
        <Button
          size="kira"
          class="font-semibold"
          :class="TONE_SOLID_CLASS.amber"
          data-testid="ade-band-rollover"
          @click="emit('rollover')"
        >
          Move to today
        </Button>
      </div>
      <div v-if="over" class="flex items-center gap-2 pl-54.5 text-kira-sm text-tone-red">
        <span>{{ overflowNote }}</span>
        <Button
          variant="dialog"
          size="kira"
          class="max-w-90 truncate border-tone-red-solid bg-transparent font-semibold text-tone-red"
          data-testid="ade-band-overflow-move"
          @click="emit('overflowMove')"
        >
          {{ overflowLabel }}
        </Button>
      </div>
      <AdeTaskCard
        v-for="card in cards"
        :key="card.task.id"
        :card="card"
        @select="emit('select', card.task.id)"
        @force-push="(row) => emit('forcePush', row)"
      />
      <Button
        v-for="s in spans"
        :key="s.taskId"
        variant="ghost"
        class="ml-54.5 h-row w-auto justify-start gap-2 border border-l-3 border-dashed border-border-strong px-2.5 font-normal text-muted-foreground"
        :style="{ borderLeftColor: s.color }"
        :title="s.tip"
        data-testid="ade-span-row"
        @click="emit('select', s.taskId)"
      >
        <span class="text-subtle">↳</span>
        <span
          class="shrink-0 whitespace-nowrap text-kira-sm"
          :class="s.merges ? 'text-tone-amber' : 'text-subtle'"
          >{{ s.note }}</span
        >
        <span class="min-w-0 truncate font-semibold text-fg">{{ s.title }}</span>
      </Button>
    </div>
  </div>
</template>
