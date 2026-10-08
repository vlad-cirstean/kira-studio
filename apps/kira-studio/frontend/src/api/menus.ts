import type { MenuItem } from '@workbench/state/contextMenu';
import { type CollectionChoice, moveToCollectionMenu } from '@workbench/util/collectionMenu';
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
  /** P11 D12: the row/background menu's own "New gRPC request" action — a sibling of newRequest,
   *  never available on a folder-less background where newRequest already targets the root. */
  newGrpcRequest(row: CollectionRowVm): void;
  newFolder(row: CollectionRowVm): void;
  newCollection(): void;
  rename(row: CollectionRowVm): void;
  duplicate(row: CollectionRowVm): void;
  remove(row: CollectionRowVm): void;
  /** Every collection, as the Move to collection submenu's choices. */
  collections(): readonly CollectionChoice[];
  moveTo(row: CollectionRowVm, collectionId: string): void;
  moveToNewCollection(row: CollectionRowVm): void;
  copyUrl(row: CollectionRowVm): void;
  importCollection(): void;
  /** P7 D12: the background menu's own "Import from curl…" item — opens the paste-a-curl-command
   *  dialog, always into a fresh tab (never row-scoped, unlike importCollection above). */
  importCurl(): void;
  exportCollection(row: CollectionRowVm): void;
  /** P5 D11, re-homed to a tab by P17 D16: the collection row's own "Variables…" item — opens
   *  (or activates) the variable-set tab scoped to it. */
  variables(row: CollectionRowVm): void;
  /** P5 D3/D11: the background menu's own "Environments…" item. */
  environments(): void;
  /** P6 D11: the background menu's own "Dynamic values…" item — opens the read-only reference
   *  dialog. Not row-scoped, same as environments() above. */
  dynamicValues(): void;
}

// Request and folder rows only: a move lands at a collection's root, so the row's own collection
// is a valid target only when the row sits inside a folder.
function moveMenu(row: CollectionRowVm, actions: CollectionMenuActions): MenuItem {
  return moveToCollectionMenu({
    collections: actions.collections(),
    current: row.collectionId,
    allowNone: false,
    canMoveTo: (id) => !(id === row.collectionId && row.parentId === null),
    onMove: (id) => {
      if (id !== null) actions.moveTo(row, id);
    },
    onNew: () => actions.moveToNewCollection(row),
  });
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
      moveMenu(row, actions),
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
      id: 'new-grpc-request',
      label: 'New gRPC request',
      icon: 'symbol-interface',
      run: () => actions.newGrpcRequest(row),
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
    // open through the environments tab's "Edit variables…" instead, D11).
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
    items.push(moveMenu(row, actions));
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
    {
      type: 'item',
      id: 'import-curl',
      label: 'Import from curl…',
      icon: 'terminal',
      run: () => actions.importCurl(),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'environments',
      label: 'Environments…',
      icon: 'settings-gear',
      run: () => actions.environments(),
    },
    {
      type: 'item',
      id: 'dynamic-values',
      label: 'Dynamic values…',
      icon: 'symbol-variable',
      run: () => actions.dynamicValues(),
    },
  ];
}
