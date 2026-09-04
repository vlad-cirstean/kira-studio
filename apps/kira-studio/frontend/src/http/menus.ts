import type { MenuItem } from '../state/contextMenu';
import type { CollectionRowVm } from './state/collections';

// P4 D13: the row and background context menus, built with the existing MenuItem type from
// state/contextMenu.ts — a permitted `http/ -> state/` edge, the same one CollectionsPanel.vue
// already uses. Shortcut ids are the existing tree.* bindings (§3): no new shortcut vocabulary,
// so ProjectTree.vue's own runMenuShortcut dispatch shape works here unchanged.
//
// The actions themselves are injected rather than imported, so this module stays free of both the
// store's mutation half and the request-view's open path — the menu is a description, and
// CollectionsTree.vue is the one place that knows how to perform any of it.
export interface CollectionMenuActions {
  open(row: CollectionRowVm): void;
  newRequest(row: CollectionRowVm): void;
  newFolder(row: CollectionRowVm): void;
  newCollection(): void;
  rename(row: CollectionRowVm): void;
  duplicate(row: CollectionRowVm): void;
  remove(row: CollectionRowVm): void;
  copyUrl(row: CollectionRowVm): void;
  importCollection(): void;
  exportCollection(row: CollectionRowVm): void;
  /** P5 D11: the collection row's own "Variables…" item — opens VariablesDialog scoped to it. */
  variables(row: CollectionRowVm): void;
  /** P5 D3/D11: the background menu's own "Environments…" item. */
  environments(): void;
}

export function menuForRow(row: CollectionRowVm, actions: CollectionMenuActions): MenuItem[] {
  if (row.kind === 'request') {
    return [
      {
        type: 'item',
        id: 'open',
        label: 'Open',
        icon: 'go-to-file',
        shortcut: 'tree.open',
        run: () => actions.open(row),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'rename',
        label: 'Rename',
        icon: 'edit',
        shortcut: 'tree.rename',
        run: () => actions.rename(row),
      },
      {
        type: 'item',
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'copy',
        shortcut: 'tree.duplicate',
        run: () => actions.duplicate(row),
      },
      {
        type: 'item',
        id: 'copy-url',
        label: 'Copy URL',
        icon: 'link',
        disabled: !row.url,
        run: () => actions.copyUrl(row),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        danger: true,
        shortcut: 'tree.delete',
        run: () => actions.remove(row),
      },
    ];
  }

  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'new-request',
      label: 'New request',
      icon: 'add',
      run: () => actions.newRequest(row),
    },
    {
      type: 'item',
      id: 'new-folder',
      label: 'New folder',
      icon: 'new-folder',
      run: () => actions.newFolder(row),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'rename',
      label: 'Rename',
      icon: 'edit',
      shortcut: 'tree.rename',
      run: () => actions.rename(row),
    },
  ];

  if (row.kind === 'collection') {
    // Variables… and Export are both collection-level actions: a collection is the unit of
    // export, and the only scope-owning row this menu ever sees (an environment's own variables
    // open through EnvironmentsDialog's "Edit variables…" instead, D11).
    items.push({
      type: 'item',
      id: 'variables',
      label: 'Variables…',
      icon: 'symbol-variable',
      run: () => actions.variables(row),
    });
    items.push({
      type: 'item',
      id: 'export',
      label: 'Export collection…',
      icon: 'export',
      run: () => actions.exportCollection(row),
    });
  } else {
    items.push({
      type: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      shortcut: 'tree.duplicate',
      run: () => actions.duplicate(row),
    });
  }

  items.push(
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      danger: true,
      shortcut: 'tree.delete',
      run: () => actions.remove(row),
    },
  );
  return items;
}

export function backgroundMenu(actions: CollectionMenuActions): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-collection',
      label: 'New collection',
      icon: 'add',
      run: () => actions.newCollection(),
    },
    {
      type: 'item',
      id: 'import-collection',
      label: 'Import collection…',
      icon: 'cloud-download',
      run: () => actions.importCollection(),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'environments',
      label: 'Environments…',
      icon: 'settings-gear',
      run: () => actions.environments(),
    },
  ];
}
