import type { MenuItem } from '../state/contextMenu';

export interface CollectionChoice {
  id: string;
  name: string;
}

/** The "Move to collection" submenu both the script and API context menus share. */
export function moveToCollectionMenu(opts: {
  collections: readonly CollectionChoice[];
  current: string | null;
  allowNone: boolean;
  /** Default: any id other than the current one. */
  canMoveTo?: (id: string | null) => boolean;
  onMove(id: string | null): void | Promise<void>;
  onNew(): void | Promise<void>;
}): MenuItem {
  const canMoveTo = opts.canMoveTo ?? ((id: string | null) => id !== opts.current);
  const items: MenuItem[] = [];
  if (opts.allowNone) {
    items.push({
      type: 'item',
      id: 'move-to-none',
      label: 'No collection',
      checked: opts.current === null,
      disabled: !canMoveTo(null),
      run: () => opts.onMove(null),
    });
  }
  for (const c of opts.collections) {
    items.push({
      type: 'item',
      id: `move-to-${c.id}`,
      label: c.name,
      checked: c.id === opts.current,
      disabled: !canMoveTo(c.id),
      run: () => opts.onMove(c.id),
    });
  }
  items.push(
    { type: 'separator' },
    {
      type: 'item',
      id: 'move-to-new',
      label: 'New collection',
      icon: 'new-folder',
      run: () => opts.onNew(),
    },
  );
  return {
    type: 'submenu',
    id: 'move-to-collection',
    label: 'Move to collection',
    icon: 'folder-library',
    items,
  };
}
