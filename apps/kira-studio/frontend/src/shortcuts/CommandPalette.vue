<script setup lang="ts">
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import { wrapSelectionOnType } from '@theme/wrapSelection';
import { usePaletteStore } from './state';

// P108 Part 12 F15 (carry-over from Part 10 F10): the hand-rolled backdrop this used to carry
// aria-hidden="true" on the very element wrapping the live, focused palette — hiding the whole
// subtree (input, listbox, every item) from assistive tech, with no role="dialog"/aria-modal, no
// focus trap and no focus restore on close. CommandDialog (packages/theme/src/components/ui/
// command/CommandDialog.vue), unused until now, is the shadcn-vue primitive built for exactly
// this — reka-ui's DialogRoot/DialogContent underneath supply all four for free, plus
// Escape-to-close and click-outside-to-close, replacing the store's own manual onClickOutside and
// the palette's own Escape handler this file used to carry.
const paletteStore = usePaletteStore();

function runCommand(id: string): void {
  const command = paletteStore.paletteCommands.find((c) => c.id === id);
  if (!command) return;
  paletteStore.closePalette();
  command.run();
}

function onOpenChange(open: boolean): void {
  if (!open) paletteStore.closePalette();
}
</script>

<template>
  <CommandDialog
    :open="paletteStore.open"
    title="Command Palette"
    description="Search for a command to run…"
    class="w-105"
    @update:open="onOpenChange"
  >
    <CommandInput
      data-testid="command-palette-input"
      placeholder="Type a command…"
      @keydown="wrapSelectionOnType"
    />
    <CommandList class="max-h-72">
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
  </CommandDialog>
</template>
