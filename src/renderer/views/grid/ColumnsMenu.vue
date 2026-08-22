<script setup lang="ts">
import type { Caps } from '@shared/caps';
import { computed, ref } from 'vue';
import { tabsState } from '../../state/tabs';
import { runtime, setProjection } from './state';

const props = defineProps<{ tabId: string; caps: Caps | null }>();
const emit = defineEmits<{ close: [] }>();

const meta = computed(() => runtime[props.tabId]?.meta ?? null);
const columnNames = computed(() => meta.value?.columns.map((c) => c.name) ?? []);

function currentProjection(): string[] | null {
  return tabsState.tabs.find((t) => t.id === props.tabId)?.state.projection ?? null;
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

function close(): void {
  const isEverything = selected.value.size === columnNames.value.length;
  void setProjection(props.tabId, isEverything ? null : [...selected.value]);
  emit('close');
}
</script>

<template>
  <div class="menu-backdrop" data-testid="columns-menu-backdrop" @click="close">
    <div class="columns-menu" data-testid="columns-menu" @click.stop>
      <div class="columns-menu-header">
        <button type="button" data-testid="columns-select-all" @click="selectAll">All</button>
        <button type="button" data-testid="columns-select-none" @click="selectNone">None</button>
      </div>
      <div v-if="!meta" class="columns-menu-loading">Loading columns…</div>
      <div v-else class="columns-menu-list">
        <label v-for="name in columnNames" :key="name" class="columns-menu-item">
          <input
            type="checkbox"
            :checked="selected.has(name)"
            data-testid="columns-menu-item"
            @change="toggle(name)"
          />
          {{ name }}
        </label>
      </div>
      <div class="columns-menu-footer" data-testid="columns-menu-footer">
        {{ caps?.projection ? 'Applied server-side' : 'Applied after fetch' }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.columns-menu {
  position: absolute;
  top: 32px;
  right: 8px;
  min-width: 200px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 12px;
}

.columns-menu-header {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.columns-menu-header button {
  background: transparent;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 2px 6px;
  font-size: 11px;
}

.columns-menu-loading {
  padding: 8px;
  color: var(--kira-fg-muted);
}

.columns-menu-list {
  overflow-y: auto;
  padding: 4px;
}

.columns-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  cursor: pointer;
}

.columns-menu-item:hover {
  background: var(--kira-hover);
}

.columns-menu-footer {
  padding: 4px 8px;
  color: var(--kira-fg-muted);
  font-size: 10px;
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
