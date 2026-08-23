<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { closePalette, paletteCommands, paletteState } from './state';

const inputRef = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);

const filtered = computed(() => {
  const q = paletteState.query.trim().toLowerCase();
  if (!q) return paletteCommands;
  return paletteCommands.filter((c) => c.label.toLowerCase().includes(q));
});

watch(
  () => paletteState.open,
  async (open) => {
    if (!open) return;
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
  },
);

watch(filtered, () => {
  activeIndex.value = 0;
});

function runAt(index: number): void {
  const command = filtered.value[index];
  if (!command) return;
  closePalette();
  command.run();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    closePalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(filtered.value.length - 1, activeIndex.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runAt(activeIndex.value);
  }
}
</script>

<template>
  <div
    v-if="paletteState.open"
    class="palette-backdrop"
    data-testid="command-palette-backdrop"
    @click="closePalette"
  >
    <div class="palette" data-testid="command-palette" @click.stop>
      <input
        ref="inputRef"
        v-model="paletteState.query"
        class="palette-input"
        data-testid="command-palette-input"
        type="text"
        placeholder="Type a command…"
        @keydown="onKeydown"
      />
      <div class="palette-list">
        <div
          v-for="(command, i) in filtered"
          :key="command.id"
          class="palette-item"
          :class="{ active: i === activeIndex }"
          data-testid="command-palette-item"
          :data-command-id="command.id"
          @mouseenter="activeIndex = i"
          @click="runAt(i)"
        >
          {{ command.label }}
        </div>
        <div v-if="filtered.length === 0" class="palette-empty">No matching commands</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 120px;
  background: rgba(0, 0, 0, 0.3);
}

.palette {
  width: 420px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  overflow: hidden;
}

.palette-input {
  padding: 10px 12px;
  border: none;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  background: transparent;
  color: var(--kira-fg);
  font-size: 13px;
  outline: none;
}

.palette-list {
  overflow-y: auto;
  padding: 4px;
}

.palette-item {
  padding: 6px 10px;
  border-radius: var(--kira-radius-sm);
  cursor: pointer;
  font-size: 12px;
}

.palette-item.active,
.palette-item:hover {
  background: var(--kira-hover);
}

.palette-empty {
  padding: 8px 10px;
  color: var(--kira-fg-muted);
  font-size: 12px;
}
</style>
