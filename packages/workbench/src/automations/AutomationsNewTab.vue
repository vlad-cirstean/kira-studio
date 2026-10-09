<script setup lang="ts">
import TabStripNewButton from '@workbench/components/TabStripNewButton.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { useAutomationsModule } from './module';

// P91 §8/§9: the tab strip's own "+" for the Terminal module — one plain, unscoped session at the
// resolved home directory. Hoisted to the shared terminal module at P128 §2.4 — TabStripNewButton
// carries the wrapper/Tooltip/button markup both apps' own "+" already shared; this file keeps
// exactly the terminal module's own menu content, verbatim from Kira Studio's own
// WorkbenchShell.vue.
const ctx = useAutomationsModule();
const contextMenuStore = useContextMenuStore();

function menuItems(): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-terminal',
      label: 'Terminal',
      icon: 'terminal-bash',
      disabled: ctx.defaultCwd() === '',
      run: () => {
        ctx.openTerminalTab({ cwd: ctx.defaultCwd() });
      },
    },
  ];
}

// P83 §9: the tab strip's own "+" — a dropdown anchored under the button, not the click point.
function onClick(button: HTMLButtonElement): void {
  const rect = button.getBoundingClientRect();
  contextMenuStore.openContextMenuAt(rect.left, rect.bottom + 2, menuItems());
}
</script>

<template>
  <TabStripNewButton label="New tab" tooltip="New tab" has-popup @click="onClick" />
</template>
