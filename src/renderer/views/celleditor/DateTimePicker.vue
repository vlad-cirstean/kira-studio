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

// The visible month is its own state, independent of the selected day — paging doesn't move the
// selection until a day cell is actually clicked. Reset to the value's own month whenever the
// value moves to a different month from outside (e.g. typing a new date into the pane's text
// field, or the cell selection itself changing).
const viewYear = ref(selected.value.y);
const viewMonth = ref(selected.value.mo);
watch(
  () => [selected.value.y, selected.value.mo] as const,
  ([y, mo]) => {
    viewYear.value = y;
    viewMonth.value = mo;
  },
);

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
        :size="12"
        data-testid="datetime-picker-prev-month"
        v-tooltip="'Previous month'"
        @click="prevMonth"
      />
      <span class="dtp-month-label" data-testid="datetime-picker-month">
        {{ MONTH_NAMES[viewMonth] }} {{ viewYear }}
      </span>
      <IconButton
        icon="chevron-right"
        :size="12"
        data-testid="datetime-picker-next-month"
        v-tooltip="'Next month'"
        @click="nextMonth"
      />
    </div>
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
      <IconButton icon="clock" :size="12" data-testid="datetime-picker-now" v-tooltip="'Now'" @click="pickNow" />
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

.dtp-month-label {
  font-size: var(--kira-t-sm);
  color: var(--kira-fg);
}

.dtp-weekdays,
.dtp-days {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
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
