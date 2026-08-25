import type { ShortcutId } from '@shared/domain/shortcuts';
import { reactive } from 'vue';

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
      /** P21: names a binding in shared/shortcuts.ts by id, never a display string — a typo is a
       *  type error, and the printed key can never drift from the key that actually runs `run()`. */
      shortcut?: ShortcutId;
      run(): void | Promise<void>;
    }
  | { type: 'submenu'; id: string; label: string; icon?: string; items: MenuItem[] }
  | { type: 'separator' };

export const contextMenuState = reactive({
  open: false,
  x: 0,
  y: 0,
  items: [] as MenuItem[],
});

export function openContextMenu(ev: MouseEvent, items: MenuItem[]): void {
  contextMenuState.items = items;
  contextMenuState.x = ev.clientX;
  contextMenuState.y = ev.clientY;
  contextMenuState.open = true;
}

export function closeContextMenu(): void {
  contextMenuState.open = false;
}

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
