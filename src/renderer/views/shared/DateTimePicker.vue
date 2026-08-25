<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';

// P24 D18: the app-owned month grid + clock steppers that replace the bare
// <input type="datetime-local"> — the last piece of OS-drawn UI left in the renderer after P22
// removed the native tooltip (F9). Pure content, no trigger and no PopoverPanel of its own:
// TimestampPane.vue owns the calendar button, the open/close state and the PopoverPanel wrapping
// this — the same trigger/content split ColumnsMenu.vue's own consumer already uses.
const props = defineProps<{ modelValue: Date; zone: 'local' | 'utc' }>();
const emit = defineEmits<{ 'update:modelValue': [Date] }>();

interface Parts {
  y: number;
  mo: number;
  day: number;
  h: number;
  mi: number;
  s: number;
}

function partsOf(d: Date): Parts {
  return props.zone === 'utc'
    ? {
        y: d.getUTCFullYear(),
        mo: d.getUTCMonth(),
        day: d.getUTCDate(),
        h: d.getUTCHours(),
        mi: d.getUTCMinutes(),
        s: d.getUTCSeconds(),
      }
    : {
        y: d.getFullYear(),
        mo: d.getMonth(),
        day: d.getDate(),
        h: d.getHours(),
        mi: d.getMinutes(),
        s: d.getSeconds(),
      };
}

function buildDate(y: number, mo: number, day: number, h: number, mi: number, s: number): Date {
  return props.zone === 'utc'
    ? new Date(Date.UTC(y, mo, day, h, mi, s))
    : new Date(y, mo, day, h, mi, s);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const selected = computed(() => partsOf(props.modelValue));
const today = computed(() => partsOf(new Date()));

// P42 D33a: the label cycles three views of the same navigation, days -> months -> years,
// so reaching a date years away no longer costs dozens of single-month clicks. D33b: picking a
// month or a year moves only *this* view state, never `selected` — the same rule prevMonth/
// nextMonth already follow below, just for a bigger jump.
type CalendarMode = 'days' | 'months' | 'years';
const mode = ref<CalendarMode>('days');

// The visible month is its own state, independent of the selected day — paging doesn't move the
// selection until a day cell is actually clicked. Reset to the value's own month (and back to the
// day grid) whenever the value moves to a different month from outside (e.g. typing a new date
// into the pane's text field, or the cell selection itself changing).
const viewYear = ref(selected.value.y);
const viewMonth = ref(selected.value.mo);
watch(
  () => [selected.value.y, selected.value.mo] as const,
  ([y, mo]) => {
    viewYear.value = y;
    viewMonth.value = mo;
    mode.value = 'days';
  },
);

function cycleMode(): void {
  mode.value = mode.value === 'days' ? 'months' : mode.value === 'months' ? 'years' : 'days';
}
function pickMonth(mo: number): void {
  viewMonth.value = mo;
  mode.value = 'days';
}
// A 16-year block, aligned to a multiple of 16 so paging never leaves the just-picked year
// stranded at a block edge.
const yearBlockStart = computed(() => Math.floor(viewYear.value / 16) * 16);
const yearBlock = computed(() => Array.from({ length: 16 }, (_, i) => yearBlockStart.value + i));
function pickYear(y: number): void {
  viewYear.value = y;
  mode.value = 'months';
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function prevMonth(): void {
  if (viewMonth.value === 0) {
    viewMonth.value = 11;
    viewYear.value -= 1;
  } else {
    viewMonth.value -= 1;
  }
}
function nextMonth(): void {
  if (viewMonth.value === 11) {
    viewMonth.value = 0;
    viewYear.value += 1;
  } else {
    viewMonth.value += 1;
  }
}

// D33a: "the prev/next arrows stay and act on whatever the current mode pages" — one month in
// the day grid, one year in the month grid, one 16-year block in the year grid.
function pagePrev(): void {
  if (mode.value === 'days') prevMonth();
  else if (mode.value === 'months') viewYear.value -= 1;
  else viewYear.value -= 16;
}
function pageNext(): void {
  if (mode.value === 'days') nextMonth();
  else if (mode.value === 'months') viewYear.value += 1;
  else viewYear.value += 16;
}

interface DayCell {
  day: number;
  year: number;
  month: number;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

// Pure calendar-day arithmetic, deliberately done in the UTC epoch-day domain regardless of
// `zone` — a calendar grid has no timezone of its own, only the *comparison* against `selected`/
// `today` below needs the zone-adjusted parts. Always 6 full weeks (42 cells) for a stable grid
// height across months rather than 5 vs. 6 depending on where the month falls.
const days = computed<DayCell[]>(() => {
  const y = viewYear.value;
  const mo = viewMonth.value;
  const firstWeekday = (new Date(Date.UTC(y, mo, 1)).getUTCDay() + 6) % 7; // Monday = 0
  const startMs = Date.UTC(y, mo, 1) - firstWeekday * 86_400_000;
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const cell = new Date(startMs + i * 86_400_000);
    const cy = cell.getUTCFullYear();
    const cmo = cell.getUTCMonth();
    const cday = cell.getUTCDate();
    cells.push({
      day: cday,
      year: cy,
      month: cmo,
      inMonth: cmo === mo && cy === y,
      isToday: cy === today.value.y && cmo === today.value.mo && cday === today.value.day,
      isSelected:
        cy === selected.value.y && cmo === selected.value.mo && cday === selected.value.day,
    });
  }
  return cells;
});

function pickDay(cell: DayCell): void {
  const p = selected.value;
  emit('update:modelValue', buildDate(cell.year, cell.month, cell.day, p.h, p.mi, p.s));
}

function pickNow(): void {
  emit('update:modelValue', new Date());
}

const labelText = computed(() => {
  if (mode.value === 'months') return String(viewYear.value);
  if (mode.value === 'years') return `${yearBlockStart.value}–${yearBlockStart.value + 15}`;
  return `${MONTH_NAMES[viewMonth.value]} ${viewYear.value}`;
});
const pagePrevTitle = computed(() =>
  mode.value === 'days'
    ? 'Previous month'
    : mode.value === 'months'
      ? 'Previous year'
      : 'Previous 16 years',
);
const pageNextTitle = computed(() =>
  mode.value === 'days' ? 'Next month' : mode.value === 'months' ? 'Next year' : 'Next 16 years',
);

// The three clock steppers, each a writable computed so <TextField type="number"> can v-model
// straight onto it — TextField already draws the app-owned up/down stepper (primitives.css's
// .stepper), so nothing here needs to reinvent that chrome, only clamp what a hand-typed value
// (as opposed to a stepper click, which stepUp/stepDown already keeps in range) can push out of
// range.
const hourText = computed<string>({
  get: () => String(selected.value.h).padStart(2, '0'),
  set: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const p = selected.value;
    emit('update:modelValue', buildDate(p.y, p.mo, p.day, clamp(n, 0, 23), p.mi, p.s));
  },
});
const minuteText = computed<string>({
  get: () => String(selected.value.mi).padStart(2, '0'),
  set: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const p = selected.value;
    emit('update:modelValue', buildDate(p.y, p.mo, p.day, p.h, clamp(n, 0, 59), p.s));
  },
});
const secondText = computed<string>({
  get: () => String(selected.value.s).padStart(2, '0'),
  set: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const p = selected.value;
    emit('update:modelValue', buildDate(p.y, p.mo, p.day, p.h, p.mi, clamp(n, 0, 59)));
  },
});
</script>

<template>
  <div class="dtp" data-testid="datetime-picker">
    <div class="dtp-month-row">
      <IconButton
        icon="chevron-left"
        data-testid="datetime-picker-prev-month"
        v-tooltip="pagePrevTitle"
        @click="pagePrev"
      />
      <button
        type="button"
        class="dtp-month-label"
        data-testid="datetime-picker-month"
        v-tooltip="'Jump by month or year'"
        @click="cycleMode"
      >
        {{ labelText }}
      </button>
      <IconButton
        icon="chevron-right"
        data-testid="datetime-picker-next-month"
        v-tooltip="pageNextTitle"
        @click="pageNext"
      />
    </div>
    <div class="dtp-body" data-testid="datetime-picker-mode" :data-mode="mode">
      <template v-if="mode === 'days'">
        <div class="dtp-weekdays">
          <span v-for="w in WEEKDAY_LABELS" :key="w" class="dtp-weekday">{{ w }}</span>
        </div>
        <div class="dtp-days">
          <button
            v-for="cell in days"
            :key="`${cell.year}-${cell.month}-${cell.day}`"
            type="button"
            class="dtp-day p-row"
            data-testid="datetime-picker-day"
            :data-in-month="cell.inMonth"
            :data-selected="cell.isSelected"
            :class="{ 'is-selected': cell.isSelected, 'is-today': cell.isToday, dim: !cell.inMonth }"
            @click="pickDay(cell)"
          >
            {{ cell.day }}
          </button>
        </div>
      </template>
      <div v-else-if="mode === 'months'" class="dtp-grid4">
        <button
          v-for="(name, i) in MONTH_NAMES"
          :key="name"
          type="button"
          class="dtp-day p-row"
          data-testid="datetime-picker-month-cell"
          :data-selected="i === viewMonth"
          :class="{ 'is-selected': i === viewMonth }"
          @click="pickMonth(i)"
        >
          {{ name.slice(0, 3) }}
        </button>
      </div>
      <div v-else class="dtp-grid4">
        <button
          v-for="y in yearBlock"
          :key="y"
          type="button"
          class="dtp-day p-row"
          data-testid="datetime-picker-year-cell"
          :data-selected="y === viewYear"
          :class="{ 'is-selected': y === viewYear }"
          @click="pickYear(y)"
        >
          {{ y }}
        </button>
      </div>
    </div>
    <div class="dtp-clock">
      <TextField
        v-model="hourText"
        type="number"
        min="0"
        max="23"
        data-testid="datetime-picker-hour"
      />
      <span class="dtp-clock-sep">:</span>
      <TextField
        v-model="minuteText"
        type="number"
        min="0"
        max="59"
        data-testid="datetime-picker-minute"
      />
      <span class="dtp-clock-sep">:</span>
      <TextField
        v-model="secondText"
        type="number"
        min="0"
        max="59"
        data-testid="datetime-picker-second"
      />
      <IconButton icon="clock" data-testid="datetime-picker-now" v-tooltip="'Now'" @click="pickNow" />
    </div>
  </div>
</template>

<style scoped>
.dtp {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
}

.dtp-month-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* P42 D33a: a plain <button> now, so the label itself is the mode-cycling control — reset to
   look like the <span> it replaces rather than a bordered control. */
.dtp-month-label {
  border: none;
  background: none;
  padding: var(--kira-s-1) var(--kira-s-2);
  border-radius: var(--kira-radius-sm);
  font-size: var(--kira-t-sm);
  font-family: inherit;
  color: var(--kira-fg);
  cursor: pointer;
}

.dtp-month-label:hover {
  background: var(--kira-hover);
}

.dtp-weekdays,
.dtp-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

/* The month grid (3x4) and year-block grid (4x4, item 19's "16-year block") share this — same
   .dtp-day chip, just a 4-column grid instead of a 7-column one (D33a). */
.dtp-grid4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 2px;
}

.dtp-weekday {
  display: flex;
  align-items: center;
  justify-content: center;
  height: var(--kira-h-xs);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
}

.dtp-day {
  height: var(--kira-h-sm);
  width: 100%;
  padding: 0;
  justify-content: center;
  border: var(--kira-border-width) solid transparent;
  background: none;
  font-family: inherit;
}

.dtp-day.is-today {
  border-color: var(--kira-border-strong);
}

.dtp-day.is-selected {
  background: var(--kira-accent);
  color: var(--kira-accent-fg);
}

.dtp-clock {
  display: flex;
  align-items: center;
  gap: var(--kira-s-1);
  padding-top: var(--kira-s-2);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.dtp-clock :deep(.p-input) {
  width: 52px;
}

.dtp-clock-sep {
  color: var(--kira-fg-disabled);
}
</style>
