import { reactive } from 'vue';

// The single renderer context-menu service (D12 / §8.10): every future menu target (grid cell, tab,
// op row, …) calls openContextMenu. Do not let a second menu implementation appear.

export type MenuItem =
  | {
      type: 'item';
      id: string;
      label: string;
      icon?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      run(): void | Promise<void>;
    }
  | { type: 'submenu'; id: string; label: string; icon?: string; items: MenuEntry[] }
  | { type: 'separator' };

// A menu entry that can be rendered inline (no separators inside a submenu).
export type MenuEntry = Exclude<MenuItem, { type: 'separator' }>;

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
