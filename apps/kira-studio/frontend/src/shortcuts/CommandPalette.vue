<script setup lang="ts">
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@theme/components/ui/command';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { usePaletteStore } from './state';

// P104 §3: list chrome, filtering and keyboard model now come from ui/command (reka's Listbox) —
// activeIndex/ArrowUp/ArrowDown/Enter and the hand-rolled `filtered` computed all delete with it.
// `paletteCommands`' own declaration order is preserved as-is: Command's filter only toggles an
// item's visibility, it never reorders, so rendering `paletteCommands` straight into the v-for
// keeps the same ranking the old computed produced.
const paletteStore = usePaletteStore();

function runCommand(id: string): void {
  const command = paletteStore.paletteCommands.find((c) => c.id === id);
  if (!command) return;
  paletteStore.closePalette();
  command.run();
}

function onKeydown(e: KeyboardEvent): void {
  wrapSelectionOnType(e);
  if (e.key === 'Escape') {
    e.preventDefault();
    paletteStore.closePalette();
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
      <Command class="rounded-none! p-0!" @keydown="onKeydown">
        <CommandInput data-testid="command-palette-input" placeholder="Type a command…" />
        <CommandList class="max-h-[300px]">
          <CommandEmpty class="dim" data-testid="command-palette-empty">No matching commands</CommandEmpty>
          <CommandItem
            v-for="command in paletteStore.paletteCommands"
            :key="command.id"
            :value="command.id"
            class="whitespace-nowrap"
            data-testid="command-palette-item"
            :data-command-id="command.id"
            @select="runCommand(command.id)"
          >
            {{ command.label }}
          </CommandItem>
        </CommandList>
      </Command>
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
  @apply w-[420px] flex flex-col;
}
</style>
