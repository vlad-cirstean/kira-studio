<script setup lang="ts" generic="R extends OpLogRecord">
// biome-ignore lint/correctness/noUnusedImports: resolves the generic="R extends OpLogRecord" attribute above — biome only sees the <script> body, never that tag's own attribute string.
import type { OpLogRecord, OpStatus } from '@shared/domain/ops';
import CodiconIcon from '@theme/CodiconIcon.vue';
import EmptyState from '@theme/components/EmptyState.vue';
import SearchField from '@theme/components/SearchField.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import Spinner from '@theme/components/Spinner.vue';
import { Button } from '@theme/components/ui/button';
import { tableHeadClass, tableHeadRowClass, tableRowClass } from '@theme/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { type MessageKey, t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { computed, ref } from 'vue';
import { useCopy } from '../behaviour/clipboard';
import { displayValue, formatClockTime, formatDuration } from '../behaviour/format';
import { useListNavigation } from '../behaviour/listNavigation';
import { useVirtualRows, VIRTUAL_ROW_CLASS } from '../behaviour/virtualRows';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';
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
const { copy } = useCopy();

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
    : opLogMenuItems(record, () => emit('cancel', record), canCancelRecord(record), copy);
}

interface OpsListItem {
  key: string;
  kind: 'op' | 'detail-command' | 'detail-error';
  record: R;
}

const expandedId = ref<string | null>(null);

const statusFilterOptions = computed(
  () =>
    [
      { value: 'all', label: t('common.state.all.option') },
      { value: 'running', label: t('common.state.running.status') },
      { value: 'error', label: t('workbench.opLog.errors.option') },
    ] as const,
);

const STATUS_LABEL: Record<OpStatus, MessageKey> = {
  running: 'common.state.running.status',
  ok: 'automations.run.state.done.status',
  error: 'workbench.opLog.error.status',
  cancelled: 'common.cancelled.status',
};

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
const activeId = ref<string | null>(null);
const { virtualItems, totalSize, onScroll, scrollToIndex } = useVirtualRows({
  count: () => listItems.value.length,
  rowHeight: () => 18,
  scrollElement: scrollEl,
  // The roving row stays mounted when it scrolls away, so it keeps focus.
  pinned: () => {
    const index = listItems.value.findIndex((item) => item.key === activeId.value);
    return index < 0 ? null : index;
  },
});

function onRowClick(record: R): void {
  toggleExpanded(record);
}

// One roving tab stop for the whole list: Tab enters at the current row, arrows move within it. The
// panel has its own filter field, so no first-letter type-ahead. Enter and Space mirror a single
// click; the Cancel button nested inside keeps its own Enter and Space.
const nav = useListNavigation<R>({
  container: scrollEl,
  items: () => props.records,
  key: (record) => record.id,
  activeKey: activeId,
  onOpen: onRowClick,
  onSelect: onRowClick,
  onMenu: (record, rect) =>
    contextMenuStore.openContextMenuAt(rect.left, rect.bottom, menuForRecord(record), {
      onRestoreFocus: () => void nav.focusKey(record.id),
    }),
  scrollToIndex: (_index, key) =>
    scrollToIndex(listItems.value.findIndex((item) => item.key === key)),
  rendered: () => virtualItems.value,
});

function onRowContextMenu(record: R, event: MouseEvent): void {
  contextMenuStore.openContextMenu(event, menuForRecord(record), {
    onRestoreFocus: () => void nav.focusKey(record.id),
  });
}

defineSlots<{
  cell(props: { column: OpLogColumn; record: R }): unknown;
  detail?(props: { record: R; part: 'command' | 'error' }): unknown;
}>();

function durationText(ms: number | null): string | null {
  return ms === null ? null : formatDuration(ms);
}
</script>

<template>
  <div class="h-full flex flex-col min-h-0 text-kira-md">
    <div class="shrink-0 flex items-center gap-2 py-1 px-2 border-b border-border">
      <div class="w-40 shrink-0">
        <SearchField
          v-model="filterTextModel"
          :placeholder="t('common.action.filter.label')"
          :aria-label="t('workbench.opLog.filter.aria')"
          data-testid="ops-filter"
        />
      </div>
      <SecondaryTabs
        variant="segmented"
        :model-value="statusFilter"
        :items="statusFilterOptions"
        @update:model-value="(v) => emit('update:statusFilter', v as OpLogStatusFilter)"
      />
      <span class="ml-auto text-muted-foreground">{{
        t('automations.runs.running.label', { count: runningCount })
      }}</span>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button variant="dialog" size="kira-lg" @click="emit('clear')">{{
            t('common.action.clear.label')
          }}</Button>
        </TooltipTrigger>
        <TooltipContent>{{ clearHint }}</TooltipContent>
      </Tooltip>
    </div>

    <EmptyState
      v-if="records.length === 0"
      class="min-h-0 flex-1"
      icon="checklist"
      :title="t('workbench.opLog.none.empty')"
    />
    <template v-else>
      <div
        :class="cn(tableHeadRowClass, tableHeadClass, 'grid items-center gap-2 px-2 shrink-0 h-4.5')"
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
        <ul
          :aria-label="t('common.module.operations.label')"
          class="relative m-0 p-0"
          :style="{ height: `${totalSize}px` }"
        >
          <template v-for="vi in virtualItems" :key="String(vi.key)">
            <!-- biome-ignore lint/a11y/useKeyWithClickEvents: Enter and Space come from useListNavigation on the list container. -->
            <li
              v-if="listItems[vi.index].kind === 'op'"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px`, gridTemplateColumns }"
              :class="cn(VIRTUAL_ROW_CLASS, tableRowClass, 'grid items-center gap-2 px-2 cursor-pointer select-text h-4.5', listItems[vi.index].record.status === 'error' && 'text-error')"
              data-testid="op-row"
              :data-status="listItems[vi.index].record.status"
              :data-op-id="listItems[vi.index].record.id"
              v-bind="nav.rowProps(listItems[vi.index].record.id)"
              @click="onRowClick(listItems[vi.index].record)"
              @contextmenu.prevent="onRowContextMenu(listItems[vi.index].record, $event)"
            >
              <template v-for="column in columns" :key="column.id">
                <span v-if="column.id === 'time'" class="font-data" data-testid="op-time-cell">{{
                  formatClockTime(listItems[vi.index].record.startedAt)
                }}</span>
                <span v-else-if="column.id === 'kind'">{{ listItems[vi.index].record.kind }}</span>
                <span v-else-if="column.id === 'status'" class="flex items-center gap-1">
                  <Spinner v-if="listItems[vi.index].record.status === 'running'" label="" />
                  {{ t(STATUS_LABEL[listItems[vi.index].record.status]) }}
                  <button
                    v-if="listItems[vi.index].record.status === 'running' && canCancelRecord(listItems[vi.index].record)"
                    type="button"
                    class="bg-transparent border-0 cursor-pointer p-0 flex text-muted-foreground"
                    :aria-label="t('workbench.opLog.cancel.aria')"
                    @click.stop="emit('cancel', listItems[vi.index].record)"
                  >
                    <CodiconIcon name="debug-stop" :size="13" />
                  </button>
                </span>
                <span v-else-if="column.id === 'duration'">{{
                  displayValue(durationText(listItems[vi.index].record.durationMs))
                }}</span>
                <template v-else-if="column.id === 'command'">
                  <Tooltip v-if="listItems[vi.index].record.status === 'error'">
                    <TooltipTrigger as-child>
                      <span class="font-data truncate min-w-0 text-error block">{{
                        listItems[vi.index].record.error
                      }}</span>
                    </TooltipTrigger>
                    <TooltipContent>{{ listItems[vi.index].record.error ?? '' }}</TooltipContent>
                  </Tooltip>
                  <Tooltip v-else>
                    <TooltipTrigger as-child>
                      <span class="font-data truncate min-w-0 block">{{
                        displayValue(listItems[vi.index].record.command)
                      }}</span>
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
                <span class="font-data px-2 whitespace-nowrap overflow-x-auto">{{
                  t('common.command.label', { value: listItems[vi.index].record.command ?? '' })
                }}</span>
              </slot>
            </li>
            <li
              v-else
              class="grid items-center grid-cols-1 overflow-hidden text-ellipsis whitespace-nowrap h-4.5 text-muted-foreground bg-elevated p-0"
              :class="VIRTUAL_ROW_CLASS"
              :style="{ transform: `translateY(${vi.start}px)`, height: `${vi.size}px` }"
            >
              <slot name="detail" :record="listItems[vi.index].record" part="error">
                <span class="font-data px-2 whitespace-nowrap overflow-x-auto">{{
                  t('workbench.opLog.errorDetail.label', { value: listItems[vi.index].record.error ?? '' })
                }}</span>
              </slot>
            </li>
          </template>
        </ul>
      </div>
    </template>
  </div>
</template>
