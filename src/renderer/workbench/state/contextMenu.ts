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
