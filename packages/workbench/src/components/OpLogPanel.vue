<script setup lang="ts" generic="R extends OpLogRecord">
// biome-ignore lint/correctness/noUnusedImports: resolves the generic="R extends OpLogRecord" attribute above — biome only sees the <script> body, never that tag's own attribute string.
import type { OpLogRecord } from '@shared/domain/ops';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { InputGroup, InputGroupInput } from '@theme/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, nextTick, ref } from 'vue';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '../util/virtualRows';
import { type OpLogColumn, type OpLogStatusFilter, opLogMenuItems } from './opLog';

// P132 Part 1 (§2.3): hoisted from Kira Studio's own workbench/panels/OperationsPanel.vue —
// store-agnostic (props/emits only, no Pinia import here), generic over each app's own record
// shape so Kira Space's git op log (Part 2) reuses this unchanged. Markup, virtual-list wiring,
// keyboard handling and every data-testid below are that file's own, byte-for-byte. `columns`
// replaces its old hard-coded `grid-cols-[90px_140px_...]` arbitrary value (P110 B36's own note
// there no longer applies — the shape is now data, not a class).
interface Props {
  records: readonly R[];
  runningCount: number;
  filterText: string;
  statusFilter: OpLogStatusFilter;
  columns: readonly OpLogColumn[];
  /** Clear button tooltip — each app states its own retention story (Studio: op_log retention is
   *  automatic; Space: the log resets when the app quits). */
  clearHint: string;
  canCancel?: (record: R) => boolean;
  menuFor?: (record: R) => MenuItem[];
}
const props = defineProps<Props>();

const emit = defineEmits<{
  'update:filterText': [value: string];
  'update:statusFilter': [value: OpLogStatusFilter];
  clear: [];
  cancel: [record: R];
}>();

const contextMenuStore = useContextMenuStore();

// `defineProps`' own default values can't reference `emit` (a local, hoisted out of setup()) —
// these stand in for withDefaults' canCancel/menuFor defaults instead, resolved per call so a
// consumer that passes neither still gets [copyCommand, copyError, cancel] and an always-cancelable
// row (opLog.ts's own opLogMenuItems).
function canCancelRecord(record: R): boolean {
  return props.canCancel ? props.canCancel(record) : true;
}
function menuForRecord(record: R): MenuItem[] {
  return props.menuFor
    ? props.menuFor(record)
    : opLogMenuItems(record, () => emit('cancel', record), canCancelRecord(record));
}

interface OpsListItem {
  key: string;
  kind: 'op' | 'detail-command' | 'detail-error';
  record: R;
}

const expandedId = ref<string | null>(null);

const statusFilterOptions = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'error', label: 'Errors' },
] as const;

const filterTextModel = computed({
  get: () => props.filterText,
  set: (value: string) => emit('update:filterText', value),
});

const gridTemplateColumns = computed(() => props.columns.map((c) => c.width).join(' '));

function toggleExpanded(record: R): void {
  expandedId.value = expandedId.value === record.id ? null : record.id;
}

const listItems = computed<OpsListItem[]>(() => {
  const out: OpsListItem[] = [];
  for (const record of props.records) {
    out.push({ key: record.id, kind: 'op', record });
    if (expandedId.value === record.id) {
      if (record.command) out.push({ key: `${record.id}-cmd`, kind: 'detail-command', record });
      if (record.error) out.push({ key: `${record.id}-err`, kind: 'detail-error', record });
    }
  }
  return out;
});

// P104 §3.4: VirtualList's own recipe, rebuilt on @tanstack/vue-virtual via the shared
// useVirtualRows composable -- every row here is a fixed 18px (the same JS/CSS-numeric
// requirement the component's own comment below states).
const scrollEl = ref<HTMLElement | null>(null);
const { virtualItems, totalSize, onScroll } = useVirtualRows({
  count: () => listItems.value.length,
  rowHeight: () => 18,
  scrollElement: scrollEl,
});

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function onRowClick(record: R): void {
  toggleExpanded(record);
}
// P105 §5.2(c): Enter/Space mirror a single click — the Cancel button nested inside stays its own
// tab stop, so this handler never claims either key from it.
function onRowKeydown(e: KeyboardEvent, record: R): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    moveRowFocus(record, e.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  onRowClick(record);
}

// One roving tab stop for the whole list: Tab enters at the current row, arrows move within it.
const focusedRowId = ref<string | null>(null);
const tabStopId = computed(() =>
  props.records.some((r) => r.id === focusedRowId.value)
    ? focusedRowId.value
    : (props.records[0]?.id ?? null),
);

function moveRowFocus(from: R, step: 1 | -1): void {
  const index = props.records.findIndex((r) => r.id === from.id);
  const target = props.records[index + step];
  if (!target) return;
  focusedRowId.value = target.id;
  void nextTick(() => {
    scrollEl.value?.querySelector<HTMLElement>(`[data-op-id="${CSS.escape(target.id)}"]`)?.focus();
  });
}

function onRowContextMenu(record: R, event: MouseEvent): void {
  contextMenuStore.openContextMenu(event, menuForRecord(record));
}

defineSlots<{
  cell(props: { column: OpLogColumn; record: R }): unknown;
  detail?(props: { record: R; part: 'command' | 'error' }): unknown;
}>();
</script>

<template>
  <div class="h-full flex flex-col min-h-0 text-kira-md">
    <div class="shrink-0 flex items-center gap-2 py-1 px-2 border-b border-border">
      <InputGroup variant="kira" class="flex-none flex w-40">
        <CodiconIcon name="filter" :size="13" class="shrink-0 text-muted-foreground" />
        <InputGroupInput
          v-model="filterTextModel"
          placeholder="Filter"
          aria-label="Filter operations"
          class="h-full p-0 font-data"
          data-testid="ops-filter"
        />
      </InputGroup>
      <ToggleGroup
        type="single"
        size="kira"
        :model-value="statusFilter"
        @update:model-value="(v) => v && emit('update:statusFilter', v as OpLogStatusFilter)"
      >
        <ToggleGroupItem v-for="opt in statusFilterOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <span class="ml-auto text-muted-foreground">{{ runningCount }} running</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="dialog" size="kira-lg" @click="emit('clear')">Clear</Button>
        </TooltipTrigger>
        <TooltipContent>{{ clearHint }}</TooltipContent>
      </Tooltip>
    </div>

    <div v-if="records.length === 0" class="min-h-0 flex-1">
      <Alert class="h-full flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center">
        <CodiconIcon name="checklist" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md font-normal text-muted-foreground">No operations yet</AlertTitle>
      </Alert>
    </div>
    <template v-else>
      <div
        class="grid items-center gap-2 px-2 shrink-0 uppercase tracking-wider h-4.5 text-muted-foreground border-b border-border"
        :style="{ gridTemplateColumns }"
      >
        <span v-for="column in columns" :key="column.id">{{ column.label }}</span>
      </div>
      <div
        ref="scrollEl"
        class="flex-1 min-h-0 overflow-auto"
        data-testid="virtual-list"
        @scroll="onScroll"
      >
        <!--
          The expanded command/error detail rows embed a #detail slot (the host app's editor, D18/D19
          P60a) inside a fixed virtual row rather than the list itself being variable-height (P2 §0
          note 14 leaves it fixed on purpose). The row height below is JS, not CSS (P24 D34) — it
          has to stay numerically equal to --kira-h-xs (18px), which every row below and any #detail
          content's own fixed-height styling must match.
        -->
        <ul aria-label="Operations" class="m-0 p-0" :style="{ height: `${totalSize}px`, position: 'relative' }">
          <template v-for="vi in virtualItems" :key="String(vi.key)">
            <li
              v-if="listItems[vi.index].kind === 'op'"
              class="grid items-center gap-2 px-2 cursor-pointer select-text h-4.5 hover:bg-hover"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px`, gridTemplateColumns }"
              :class="[VIRTUAL_ROW_CLASS, { 'text-error': listItems[vi.index].record.status === 'error' }]"
              data-testid="op-row"
              :data-status="listItems[vi.index].record.status"
              :data-op-id="listItems[vi.index].record.id"
              :tabindex="listItems[vi.index].record.id === tabStopId ? 0 : -1"
              @focus="focusedRowId = listItems[vi.index].record.id"
              @click="onRowClick(listItems[vi.index].record)"
              @keydown="onRowKeydown($event, listItems[vi.index].record)"
              @contextmenu.prevent="onRowContextMenu(listItems[vi.index].record, $event)"
            >
              <template v-for="column in columns" :key="column.id">
                <span v-if="column.id === 'time'" class="font-data" data-testid="op-time-cell">{{
                  formatTime(listItems[vi.index].record.startedAt)
                }}</span>
                <span v-else-if="column.id === 'kind'">{{ listItems[vi.index].record.kind }}</span>
                <span v-else-if="column.id === 'status'" class="flex items-center gap-1">
                  <CodiconIcon
                    v-if="listItems[vi.index].record.status === 'running'"
                    name="loading"
                    class="animate-spin"
                    :size="13"
                  />
                  {{ listItems[vi.index].record.status }}
                  <button
                    v-if="listItems[vi.index].record.status === 'running' && canCancelRecord(listItems[vi.index].record)"
                    type="button"
                    class="bg-transparent border-0 cursor-pointer p-0 flex text-muted-foreground"
                    aria-label="Cancel operation"
                    @click.stop="emit('cancel', listItems[vi.index].record)"
                  >
                    <CodiconIcon name="debug-stop" :size="13" />
                  </button>
                </span>
                <span v-else-if="column.id === 'duration'">{{
                  formatDuration(listItems[vi.index].record.durationMs)
                }}</span>
                <template v-else-if="column.id === 'command'">
                  <Tooltip v-if="listItems[vi.index].record.status === 'error'">
                    <TooltipTrigger as-child>
                      <span class="font-data truncate min-w-0 text-error block">{{ listItems[vi.index].record.error }}</span>
                    </TooltipTrigger>
                    <TooltipContent>{{ listItems[vi.index].record.error ?? '' }}</TooltipContent>
                  </Tooltip>
                  <Tooltip v-else>
                    <TooltipTrigger as-child>
                      <span class="font-data truncate min-w-0 block">{{ listItems[vi.index].record.command ?? '—' }}</span>
                    </TooltipTrigger>
                    <TooltipContent>{{ listItems[vi.index].record.command ?? '' }}</TooltipContent>
                  </Tooltip>
                </template>
                <slot v-else name="cell" :column="column" :record="listItems[vi.index].record" />
              </template>
            </li>
            <li
              v-else-if="listItems[vi.index].kind === 'detail-command'"
              class="grid items-center grid-cols-1 overflow-hidden text-ellipsis whitespace-nowrap h-4.5 text-muted-foreground bg-elevated p-0"
              :class="VIRTUAL_ROW_CLASS"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
            >
              <slot name="detail" :record="listItems[vi.index].record" part="command">
                <span class="font-data px-2 whitespace-nowrap overflow-x-auto">command: {{ listItems[vi.index].record.command }}</span>
              </slot>
            </li>
            <li
              v-else
              class="grid items-center grid-cols-1 overflow-hidden text-ellipsis whitespace-nowrap h-4.5 text-muted-foreground bg-elevated p-0"
              :class="VIRTUAL_ROW_CLASS"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
            >
              <slot name="detail" :record="listItems[vi.index].record" part="error">
                <span class="font-data px-2 whitespace-nowrap overflow-x-auto">error: {{ listItems[vi.index].record.error }}</span>
              </slot>
            </li>
          </template>
        </ul>
      </div>
    </template>
  </div>
</template>
