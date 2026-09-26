import { decodePath } from '@shared/domain/tree';
import type { MenuItem } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { useConnectionsStore } from '../state/connections';
import { useTabsStore } from '../state/tabs';
import { type CountableKind, countTab } from '../state/viewCommands';
import { useTreeStore } from './state/tree';

// P107 I2-15: relationMenu/collectionMenu/streamNodeMenu/consumerGroupMenu (menus.ts) and
// keyRowMenu/objectRowMenu (views/browse/menu.ts) each hand-rolled the same open/open-in-new-tab
// pair, the same caps-gated "Open definition" row, the same copy-name(-qualified) pair and the
// same "open a tab, then count it" row — differing only in id/label/icon and which tab opener they
// call. `row` below is the minimal shape every row-like value (a project tree TreeRowVm, or a
// browse TreeNode plus its own connectionId) already has.

export interface MenuRowLike {
  connectionId: string;
  path: string;
  name: string;
}

const QUALIFIED_KINDS = new Set([
  'schema',
  'table',
  'view',
  'matview',
  'sequence',
  'function',
  'collection',
]);

// Produced locally from the path — never round-trips to the engine for a string join (§9b).
// P115 H9: module-private since copyNameItems below became menus.ts's only caller (P118 cleanup).
function qualifiedNameFor(row: MenuRowLike): string {
  const decoded = decodePath(row.connectionId, row.path);
  return decoded.segments
    .filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

// The Open / Open in new tab pair. Display-only shortcut (P21 D5): Enter fires the tree/panel's
// own onOpen(row) directly (the same action double-click performs), not this run() via
// runMenuShortcut.
export function openItems(
  row: MenuRowLike,
  opts: {
    idBase: string;
    label: string;
    icon: string;
    openTab: (connectionId: string, path: string, tabOpts?: { newTab?: boolean }) => unknown;
  },
): MenuItem[] {
  return [
    {
      type: 'item',
      id: opts.idBase,
      label: opts.label,
      icon: opts.icon,
      shortcut: 'tree.open',
      run: () => {
        opts.openTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: `${opts.idBase}-new-tab`,
      label: `${opts.label} in new tab`,
      icon: opts.icon,
      run: () => {
        opts.openTab(row.connectionId, row.path, { newTab: true });
      },
    },
  ];
}

// D5: offered only when the connection's caps say so — never a permanently disabled row.
export function definitionItem(row: MenuRowLike): MenuItem[] {
  if (useConnectionsStore().states[row.connectionId]?.caps?.definition !== true) return [];
  return [
    {
      type: 'item',
      id: 'open-definition',
      label: 'Open definition',
      icon: 'file-code',
      run: () => {
        useTabsStore().openDefinitionTab(row.connectionId, row.path);
      },
    },
  ];
}

export function copyNameItems(row: MenuRowLike, qualified = false): MenuItem[] {
  const items: MenuItem[] = [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
  ];
  if (qualified) {
    items.push({
      type: 'item',
      id: 'copy-qualified-name',
      label: 'Copy qualified name',
      icon: 'copy',
      run: () => copyText(qualifiedNameFor(row)),
    });
  }
  return items;
}

// Only relationMenu/collectionMenu share this exact refreshObject call — every other menu's own
// Refresh row reaches a different store method and stays where it is.
export function refreshItem(row: MenuRowLike): MenuItem {
  return {
    type: 'item',
    id: 'refresh',
    label: 'Refresh',
    icon: 'refresh',
    run: () => useTreeStore().refreshObject(row.connectionId, row.path),
  };
}

// Opens (or reuses) the row's own tab and runs Σ on it — never a bare count with nowhere to show
// the answer.
export function countItem(
  row: MenuRowLike,
  opts: {
    id: string;
    label: string;
    kind: CountableKind;
    openTab: (connectionId: string, path: string) => { id: string };
  },
): MenuItem {
  return {
    type: 'item',
    id: opts.id,
    label: opts.label,
    icon: 'symbol-numeric',
    run: () => {
      const { id: tabId } = opts.openTab(row.connectionId, row.path);
      countTab(opts.kind, tabId);
    },
  };
}
