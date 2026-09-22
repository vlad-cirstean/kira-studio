import type { ShortcutId } from '@shared/domain/shortcuts';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';

export type MenuItem =
  | {
      type: 'item';
      id: string;
      label: string;
      icon?: string;
      /** Renders a small color swatch instead of an icon — used by the Color submenu. */
      swatch?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      /** P42 D27: a hover explanation for this one row (e.g. the cell editor's format picker) —
       *  rendered as a plain v-tooltip, so it inherits every existing tooltip behavior (delay,
       *  a11y mirror) for free rather than the row inventing its own. */
      hint?: string;
      /** P21: names a binding in shared/domain/shortcuts.ts by id, never a display string — a typo is a
       *  type error, and the printed key can never drift from the key that actually runs `run()`. */
      shortcut?: ShortcutId;
      run(): void | Promise<void>;
    }
  | { type: 'submenu'; id: string; label: string; icon?: string; items: MenuItem[] }
  | { type: 'separator' };

export const useContextMenuStore = defineStore('contextMenu', () => {
  const state = reactive({
    open: false,
    x: 0,
    y: 0,
    items: [] as MenuItem[],
  });

  // P83 §9.2: a point, not an event — a dropdown anchored under a button (TabStrip.vue's "+") has
  // no MouseEvent of its own to read clientX/clientY from. openContextMenu below is now this plus
  // one destructure.
  function openContextMenuAt(x: number, y: number, items: MenuItem[]): void {
    state.items = items;
    state.x = x;
    state.y = y;
    state.open = true;
  }

  function openContextMenu(ev: MouseEvent, items: MenuItem[]): void {
    openContextMenuAt(ev.clientX, ev.clientY, items);
  }

  function closeContextMenu(): void {
    state.open = false;
  }

  return { ...toRefs(state), openContextMenuAt, openContextMenu, closeContextMenu };
});

// P100 Part 2: Studio's own runMenuShortcut (keydown-triggered menu dispatch, e.g. F2/Delete on a
// tree row) dropped — kira-space ported no tree/grid whose own keydown handler calls it, and no
// MenuItem built here sets `.shortcut` yet (ContextMenu.vue's own display of it stays ready for
// when one does). `MenuItem.shortcut` itself stays in the type/renderer, not dead: re-add this
// dispatcher alongside the first real caller instead of carrying it unused.
