<script setup lang="ts">
// P104 §5: the point-anchored singleton menu, reopened on reka's own DropdownMenuRoot. One shared
// menu opened imperatively from useContextMenuStore() at an arbitrary (x, y) — a 0x0 fixed
// DropdownMenuTrigger at that point is the same virtual-anchor shape reka's own ContextMenuTrigger
// renders internally (MenuAnchor :reference), expressed with public components only (§5.2).
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { useContextMenuStore } from '../state/contextMenu';
import MenuItems from './MenuItems.vue';

const contextMenuStore = useContextMenuStore();

function onUpdateOpen(open: boolean): void {
  if (!open) contextMenuStore.closeContextMenu();
}

// reka would return focus to the 0x0 trigger; the element that held it before the menu opened gets
// it instead, unless the chosen item already moved focus into a dialog.
function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  if (!document.activeElement?.closest('[data-slot="dialog-content"]'))
    contextMenuStore.restoreFocus();
  contextMenuStore.runAfterClose();
}
</script>

<template>
  <DropdownMenu :open="contextMenuStore.open" @update:open="onUpdateOpen">
    <DropdownMenuTrigger as-child>
      <span
        class="fixed size-0"
        :style="{ left: `${contextMenuStore.x}px`, top: `${contextMenuStore.y}px` }"
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
    <!-- prioritize-position: flip before shift. With a 0x0 point anchor, shift alone clamps the
         overflow to zero and flip never reacts, leaving a sliver near the viewport edge. -->
    <DropdownMenuContent
      align="start"
      :side-offset="0"
      prioritize-position
      data-testid="context-menu"
      @close-auto-focus="onCloseAutoFocus"
    >
      <MenuItems :items="contextMenuStore.items" />
    </DropdownMenuContent>
  </DropdownMenu>
</template>
