<script setup lang="ts">
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { computed, nextTick, ref, watch } from 'vue';
import { usePaletteStore } from './state';

const paletteStore = usePaletteStore();
const inputRef = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);

const filtered = computed(() => {
  const q = paletteStore.query.trim().toLowerCase();
  if (!q) return paletteStore.paletteCommands;
  return paletteStore.paletteCommands.filter((c) => c.label.toLowerCase().includes(q));
});

watch(
  () => paletteStore.open,
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
  paletteStore.closePalette();
  command.run();
}

function onKeydown(e: KeyboardEvent): void {
  wrapSelectionOnType(e);
  if (e.key === 'Escape') {
    e.preventDefault();
    paletteStore.closePalette();
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
    v-if="paletteStore.open"
    class="palette-backdrop"
    data-testid="command-palette-backdrop"
    @click="paletteStore.closePalette"
  >
    <div class="palette p-float" data-testid="command-palette" @click.stop>
      <div class="palette-input-pad">
        <div class="p-input ui md palette-input">
          <input
            ref="inputRef"
            v-model="paletteStore.query"
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
@reference "@theme/base.css";

.palette-backdrop {
  /* P28 D17(c): the dialog rung — the palette is a modal over the whole workbench, and this was
     a bare 100, the literal DialogFrame used to carry. Same relationship, named. */
  @apply fixed inset-0 flex items-start justify-center pt-[120px] bg-black/30;
  z-index: var(--kira-z-dialog);
}

.palette {
  @apply w-[420px] max-h-[360px] flex flex-col;
}

/* Command palette — Menus.html: one bordered p-input inset in its own padded
   row, then the list below a hairline, rather than a borderless full-bleed
   field. */
.palette-input-pad {
  @apply shrink-0;
  padding: var(--kira-s-3);
}

.palette-input {
  @apply w-full;
}

.palette-list {
  @apply overflow-y-auto flex flex-col gap-px;
  padding: var(--kira-s-2);
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.palette-item {
  @apply whitespace-nowrap;
}

.palette-empty {
  @apply flex items-center;
  height: var(--kira-h-sm);
  padding: 0 var(--kira-s-3);
  font-size: var(--kira-t-md);
}
</style>
