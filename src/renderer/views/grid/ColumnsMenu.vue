<script setup lang="ts">
import type { Caps } from '@shared/caps';
import { computed, ref } from 'vue';
import { findDataTab } from '../../state/tabs';
import Button from '../../theme/primitives/Button.vue';
import Popover from '../../theme/primitives/Popover.vue';
import { runtime, setProjection } from './state';

const props = defineProps<{ tabId: string; caps: Caps | null }>();
const emit = defineEmits<{ close: [] }>();

const meta = computed(() => runtime[props.tabId]?.meta ?? null);
const columnNames = computed(() => meta.value?.columns.map((c) => c.name) ?? []);

function currentProjection(): string[] | null {
  return findDataTab(props.tabId)?.state.projection ?? null;
}

const selected = ref<Set<string>>(new Set(currentProjection() ?? columnNames.value));

function toggle(name: string): void {
  if (selected.value.has(name)) selected.value.delete(name);
  else selected.value.add(name);
}
function selectAll(): void {
  selected.value = new Set(columnNames.value);
}
function selectNone(): void {
  selected.value = new Set();
}

// Order-independent: `selected` is a Set, so toggling a column off and back on again before
// closing moves it to the end of iteration order without changing which columns are selected —
// that must still compare equal to the projection already applied, or a no-op re-toggle would
// re-run the query same as a real change would.
function sameProjection(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((name) => setA.has(name));
}

function close(): void {
  const isEverything = selected.value.size === columnNames.value.length;
  const next = isEverything ? null : [...selected.value];
  if (!sameProjection(next, currentProjection())) {
    void setProjection(props.tabId, next);
  }
  emit('close');
}
</script>

<template>
  <Popover
    anchor="right"
    :width="200"
    test-id="columns-menu"
    backdrop-test-id="columns-menu-backdrop"
    @close="close"
  >
    <div class="columns-menu-inner">
      <div class="columns-menu-header">
        <Button data-testid="columns-select-all" @click="selectAll"> All </Button>
        <Button data-testid="columns-select-none" @click="selectNone"> None </Button>
      </div>
      <div v-if="!meta" class="columns-menu-loading p-sm muted">Loading columns…</div>
      <div v-else class="columns-menu-list">
        <label v-for="name in columnNames" :key="name" class="columns-menu-item p-row">
          <input
            type="checkbox"
            :checked="selected.has(name)"
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
  </Popover>
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
}

.columns-menu-footer {
  padding: 0 var(--kira-s-3) var(--kira-s-3);
}
</style>
