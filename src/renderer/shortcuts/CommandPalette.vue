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
    <div class="palette p-float" data-testid="command-palette" @click.stop>
      <div class="palette-input-pad">
        <div class="p-input ui md palette-input">
          <input
            ref="inputRef"
            v-model="paletteState.query"
            data-testid="command-palette-input"
            type="text"
            placeholder="Type a command…"
            @keydown="onKeydown"
          />
        </div>
      </div>
      <div class="palette-list">
        <div
          v-for="(command, i) in filtered"
          :key="command.id"
          class="p-row palette-item"
          :class="{ 'is-selected': i === activeIndex }"
          data-testid="command-palette-item"
          :data-command-id="command.id"
          @mouseenter="activeIndex = i"
          @click="runAt(i)"
        >
          {{ command.label }}
        </div>
        <div v-if="filtered.length === 0" class="palette-empty dim">No matching commands</div>
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
}

/* Command palette — Menus.html: one bordered p-input inset in its own padded
   row, then the list below a hairline, rather than a borderless full-bleed
   field. */
.palette-input-pad {
  flex-shrink: 0;
  padding: var(--kira-s-3);
}

.palette-input {
  width: 100%;
}

.palette-list {
  overflow-y: auto;
  padding: var(--kira-s-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.palette-item {
  white-space: nowrap;
}

.palette-empty {
  height: var(--kira-h-sm);
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-3);
  font-size: var(--kira-t-md);
}
</style>
