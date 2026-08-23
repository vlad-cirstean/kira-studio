<script setup lang="ts">
import type { Caps } from '@shared/caps';
import { computed, ref } from 'vue';
import { findDataTab } from '../../state/tabs';
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

function close(): void {
  const isEverything = selected.value.size === columnNames.value.length;
  void setProjection(props.tabId, isEverything ? null : [...selected.value]);
  emit('close');
}
</script>

<template>
  <div class="menu-backdrop" data-testid="columns-menu-backdrop" @click="close">
    <div class="columns-menu p-float" data-testid="columns-menu" @click.stop>
      <div class="columns-menu-header">
        <button type="button" class="p-btn" data-testid="columns-select-all" @click="selectAll">
          All
        </button>
        <button type="button" class="p-btn" data-testid="columns-select-none" @click="selectNone">
          None
        </button>
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
