<script setup lang="ts">
import type { Caps } from '@shared/caps';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Label } from '@theme/components/ui/label';
import { PopoverContent } from '@theme/components/ui/popover';
import { Separator } from '@theme/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useDragReorder } from '@workbench/util/useDragReorder';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useTabsStore } from '../../state/tabs';
import { nextProjectionFromSelectedColumns } from './menu';
import { useGridViewStore } from './state';

const props = defineProps<{ tabId: string; caps: Caps | null }>();
const gridViewStore = useGridViewStore();

const meta = computed(() => gridViewStore.runtime[props.tabId]?.meta ?? null);
const columnNames = computed(() => meta.value?.columns.map((c) => c.name) ?? []);
// PK columns can't be hidden — a row can't be identified/edited without it, and the grid's own
// mutation path assumes every visible PK column is present.
const pkNames = computed(
  () => new Set(meta.value?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? []),
);

function currentProjection(): string[] | null {
  return useTabsStore().findDataTab(props.tabId)?.state.projection ?? null;
}
function currentColumnOrder(): string[] | null {
  return useTabsStore().findDataTab(props.tabId)?.state.columnOrder ?? null;
}

const selected = ref<Set<string>>(new Set(currentProjection() ?? columnNames.value));
// The drag-reorderable display order — seeded from whatever's stored (filtered/extended to the
// live column set), mirroring columns.ts's resolveColumnOrder() so this menu and the grid never
// disagree: stored order first (dropping any column that no longer exists), then new columns
// appended in their natural position.
function initialOrder(): string[] {
  const stored = currentColumnOrder();
  if (!stored) return columnNames.value;
  const known = new Set(columnNames.value);
  const kept = stored.filter((n) => known.has(n));
  const missing = columnNames.value.filter((n) => !kept.includes(n));
  return [...kept, ...missing];
}
const order = ref<string[]>(initialOrder());

function toggle(name: string): void {
  if (pkNames.value.has(name)) return; // primary key: always visible, checkbox is a no-op
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
function selectAll(): void {
  selected.value = new Set(columnNames.value);
}
function selectNone(): void {
  selected.value = new Set(pkNames.value);
}

function sameProjection(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((name) => setA.has(name));
}
function sameOrder(a: string[], b: string[] | null): boolean {
  if (b === null) return false;
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

// P107 T2-20: same drag reorder EnvironmentsView.vue/VariableSetView.vue use — persistence stays
// in onBeforeUnmount below (commits `order` alongside `selected`), so no onReorder callback here.
const { dragIndex, onDragStart, onDragOver, onDragEnd } = useDragReorder(order);

// P104 §3: PopoverPanel's own @close (fired for every dismissal reason: outside click, Escape,
// the toggle button) becomes onBeforeUnmount — DataToolbar.vue's Popover mounts this component
// only while its own columnsOpen is true (v-if), so unmount fires exactly once, for the same set
// of reasons, and commits whatever's staged in `selected`/`order` regardless of why it closed.
onBeforeUnmount(() => {
  const nextProjection = nextProjectionFromSelectedColumns([...selected.value], columnNames.value);
  if (!sameProjection(nextProjection, currentProjection())) {
    void gridViewStore.setProjection(props.tabId, nextProjection);
  }
  // A columnOrder is only ever stored non-null when it actually diverges from the column set's
  // own natural order. Comparing only against currentColumnOrder() (as this used to) meant simply
  // opening the menu and closing it without dragging anything would stage the default order as a
  // "custom" one the first time (currentColumnOrder() starts null, and sameOrder(_, null) is
  // always false) — stamping DataToolbar's Columns button with a "changed" dot for a change that
  // never happened.
  const nextOrder = sameOrder(order.value, columnNames.value) ? null : order.value;
  const current = currentColumnOrder();
  const orderChanged =
    (nextOrder === null) !== (current === null) ||
    (nextOrder !== null && !sameOrder(nextOrder, current));
  if (orderChanged) {
    gridViewStore.setColumnOrder(props.tabId, nextOrder);
  }
});
</script>

<template>
  <PopoverContent align="end" class="w-[200px] gap-0 p-0" data-testid="columns-menu">
    <div class="columns-menu-inner">
      <div class="columns-menu-header">
        <Button variant="toolbar" size="kira" data-testid="columns-select-all" @click="selectAll">All</Button>
        <Button variant="toolbar" size="kira" data-testid="columns-select-none" @click="selectNone">None</Button>
      </div>
      <div v-if="!meta" class="columns-menu-loading p-sm muted">Loading columns…</div>
      <!-- Drag by the grip handle to reorder — the same order the grid renders columns in
           (columns.ts's resolveColumnOrder). Checkbox toggles visibility; the PK's is locked. -->
      <div v-else class="columns-menu-list">
        <Label
          v-for="(name, index) in order"
          :key="name"
          class="columns-menu-item p-row"
          :class="{ 'is-pk': pkNames.has(name), 'is-dragging': dragIndex === index }"
          draggable="true"
          @dragstart="onDragStart(index)"
          @dragover.prevent="onDragOver(index)"
          @dragend="onDragEnd"
        >
          <span class="drag-handle" aria-hidden="true"><CodiconIcon name="gripper" :size="13" /></span>
          <Tooltip v-if="pkNames.has(name)">
            <TooltipTrigger as-child>
              <Checkbox
                :model-value="selected.has(name)"
                disabled
                data-testid="columns-menu-item"
                @update:model-value="toggle(name)"
              >
                <CodiconIcon name="check" :size="10" />
              </Checkbox>
            </TooltipTrigger>
            <TooltipContent>Primary key — always shown</TooltipContent>
          </Tooltip>
          <Checkbox
            v-else
            :model-value="selected.has(name)"
            data-testid="columns-menu-item"
            @update:model-value="toggle(name)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          {{ name }}
        </Label>
      </div>
      <Separator class="my-1" />
      <div class="columns-menu-footer p-xs dim" data-testid="columns-menu-footer">
        {{ caps?.projection ? 'Applied server-side' : 'Applied after fetch' }}
      </div>
    </div>
  </PopoverContent>
</template>

<style scoped>
@reference "@theme/base.css";

.columns-menu-inner {
  @apply max-h-[320px] flex flex-col;
}

.columns-menu-header {
  @apply flex border-b border-border gap-1 p-1;
}

.columns-menu-loading {
  @apply p-2;
}

.columns-menu-list {
  @apply overflow-y-auto p-0.5;
}

.columns-menu-item {
  @apply cursor-pointer gap-1;
}

.columns-menu-item.is-dragging {
  @apply opacity-50;
}

.drag-handle {
  @apply flex items-center shrink-0 text-subtle cursor-grab;
}

.columns-menu-footer {
  @apply px-1.5 pb-1.5;
}
</style>
