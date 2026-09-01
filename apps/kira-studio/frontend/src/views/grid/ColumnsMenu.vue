<script setup lang="ts">
import type { Caps } from '@shared/caps';
import { computed, ref } from 'vue';
import { findDataTab } from '../../state/tabs';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import PopoverPanel from '../../theme/primitives/PopoverPanel.vue';
import { runtime, setColumnOrder, setProjection } from './state';

const props = defineProps<{ tabId: string; caps: Caps | null }>();
const emit = defineEmits<{ close: [] }>();

const meta = computed(() => runtime[props.tabId]?.meta ?? null);
const columnNames = computed(() => meta.value?.columns.map((c) => c.name) ?? []);
// PK columns can't be hidden — a row can't be identified/edited without it, and the grid's own
// mutation path assumes every visible PK column is present.
const pkNames = computed(
  () => new Set(meta.value?.columns.filter((c) => c.isPrimaryKey).map((c) => c.name) ?? []),
);

function currentProjection(): string[] | null {
  return findDataTab(props.tabId)?.state.projection ?? null;
}
function currentColumnOrder(): string[] | null {
  return findDataTab(props.tabId)?.state.columnOrder ?? null;
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

const dragIndex = ref<number | null>(null);

function onDragStart(index: number): void {
  dragIndex.value = index;
}
function onDragOver(index: number): void {
  const from = dragIndex.value;
  if (from === null || from === index) return;
  const next = [...order.value];
  const [moved] = next.splice(from, 1);
  next.splice(index, 0, moved);
  order.value = next;
  dragIndex.value = index;
}
function onDragEnd(): void {
  dragIndex.value = null;
}

function close(): void {
  const isEverything = selected.value.size === columnNames.value.length;
  const nextProjection = isEverything ? null : [...selected.value];
  if (!sameProjection(nextProjection, currentProjection())) {
    void setProjection(props.tabId, nextProjection);
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
    setColumnOrder(props.tabId, nextOrder);
  }
  emit('close');
}
</script>

<template>
  <PopoverPanel
    anchor="right"
    :width="200"
    test-id="columns-menu"
    backdrop-test-id="columns-menu-backdrop"
    @close="close"
  >
    <div class="columns-menu-inner">
      <div class="columns-menu-header">
        <AppButton data-testid="columns-select-all" @click="selectAll"> All </AppButton>
        <AppButton data-testid="columns-select-none" @click="selectNone"> None </AppButton>
      </div>
      <div v-if="!meta" class="columns-menu-loading p-sm muted">Loading columns…</div>
      <!-- Drag by the grip handle to reorder — the same order the grid renders columns in
           (columns.ts's resolveColumnOrder). Checkbox toggles visibility; the PK's is locked. -->
      <div v-else class="columns-menu-list">
        <label
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
          <input
            type="checkbox"
            :checked="selected.has(name)"
            :disabled="pkNames.has(name)"
            v-tooltip="pkNames.has(name) ? 'Primary key — always shown' : undefined"
            data-testid="columns-menu-item"
            @change="toggle(name)"
          />
          {{ name }}
        </label>
      </div>
      <div class="p-sep" />
      <div class="columns-menu-footer p-xs dim" data-testid="columns-menu-footer">
        {{ caps?.projection ? 'Applied server-side' : 'Applied after fetch' }}
      </div>
    </div>
  </PopoverPanel>
</template>

<style scoped>
.columns-menu-inner {
  max-height: 320px;
  display: flex;
  flex-direction: column;
}

.columns-menu-header {
  display: flex;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.columns-menu-loading {
  padding: var(--kira-s-4);
}

.columns-menu-list {
  overflow-y: auto;
  padding: var(--kira-s-1);
}

.columns-menu-item {
  cursor: pointer;
  gap: var(--kira-s-2);
}

.columns-menu-item.is-dragging {
  opacity: 0.5;
}

.drag-handle {
  display: flex;
  align-items: center;
  color: var(--kira-fg-disabled);
  cursor: grab;
  flex-shrink: 0;
}

.columns-menu-footer {
  padding: 0 var(--kira-s-3) var(--kira-s-3);
}
</style>
