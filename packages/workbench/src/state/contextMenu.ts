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
       *  rendered through the same Tooltip/TooltipTrigger/TooltipContent trio every other hint
       *  uses (P104 §5.3), so it inherits the shared open-delay/rearm behavior for free rather than
       *  the row inventing its own. */
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

// P21 D5: a new local keybinding dispatches through the same menu-builder function a right-click
// would call, rather than a parallel handler — the printed shortcut and the executed action are
// then the same object, and `disabled` gating (canEdit, a missing record, …) is honoured for
// free instead of being restated at the keydown site. Walks one level into submenus (e.g.
// `copy-rows-tsv` lives inside `rowMenu`'s "Copy row(s)" submenu).
export function runMenuShortcut(items: MenuItem[], id: ShortcutId): boolean {
  for (const item of items) {
    if (item.type === 'item' && item.shortcut === id && !item.disabled) {
      void item.run();
      return true;
    }
    if (item.type === 'submenu') {
      for (const sub of item.items) {
        if (sub.type === 'item' && sub.shortcut === id && !sub.disabled) {
          void sub.run();
          return true;
        }
      }
    }
  }
  return false;
}
