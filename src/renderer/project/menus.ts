import { connectionColorSchema } from '@shared/domain/connection';
import { decodePath, pathParent } from '@shared/domain/tree';
import { formatConnectionUri } from '@shared/domain/uri';
import { control } from '../bridge/control';
import {
  connectConnection,
  connectionsState,
  deleteConnection,
  disconnectConnection,
  duplicateConnection,
  openCreateDialog,
  openEditDialog,
  setConnectionColor,
  setConnectionReadOnly,
} from '../state/connections';
import { activeTab, openDataTab, tabsState } from '../state/tabs';
import { runCount, setFilter, setProjection, setSort } from '../views/grid/state';
import type { MenuItem } from '../workbench/state/contextMenu';
import {
  collapseAll,
  openFiltersDialog,
  refresh,
  refreshAllConnections,
  rowKey,
  type TreeRowVm,
  treeState,
} from './state/tree';

function copyText(text: string): void {
  void navigator.clipboard.writeText(text);
}

const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview', 'sequence', 'function']);

// Produced locally from the path — never round-trips to the engine for a string join (§9b).
function qualifiedNameFor(row: TreeRowVm): string {
  const decoded = decodePath(row.connectionId, row.path);
  return decoded.segments
    .filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

export function menuForRow(row: TreeRowVm): MenuItem[] {
  switch (row.kind) {
    case 'connection':
      return connectionMenu(row);
    case 'database':
    case 'schema':
      return containerMenu(row);
    case 'table':
    case 'view':
    case 'matview':
      return relationMenu(row);
    case 'sequence':
    case 'function':
      return simpleObjectMenu(row);
    case 'column':
      return columnMenu(row);
    default:
      return [];
  }
}

function connectionMenu(row: TreeRowVm): MenuItem[] {
  const status = connectionsState.states[row.connectionId]?.status ?? 'disconnected';
  const record = connectionsState.records.find((r) => r.id === row.connectionId);
  const isLive = status === 'connected' || status === 'connecting';

  const items: MenuItem[] = [
    isLive
      ? {
          type: 'item',
          id: 'disconnect',
          label: 'Disconnect',
          icon: 'debug-disconnect',
          run: () => disconnectConnection(row.connectionId),
        }
      : {
          type: 'item',
          id: 'connect',
          label: 'Connect',
          icon: 'plug',
          run: () => connectConnection(row.connectionId),
        },
    {
      type: 'item',
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      run: () => refresh(row.connectionId, ''),
    },
    {
      type: 'item',
      id: 'edit',
      label: 'Edit…',
      icon: 'edit',
      run: () => openEditDialog(row.connectionId),
    },
    {
      type: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      run: () => duplicateConnection(row.connectionId),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'copy-uri',
      label: 'Copy URI',
      icon: 'link',
      // Always passwordless (D7) — for a fields-mode connection there is no stored URI, so
      // one is synthesised from the fields, matching what the dialog itself would generate.
      run: () => {
        if (!record) return;
        const uri =
          record.mode === 'uri' && record.uri
            ? record.uri
            : formatConnectionUri({ ...record, password: null });
        copyText(uri);
      },
    },
    {
      type: 'item',
      id: 'filters',
      label: 'Filters…',
      icon: 'filter',
      run: () => openFiltersDialog(row.connectionId),
    },
    {
      type: 'submenu',
      id: 'color',
      label: 'Color',
      icon: 'symbol-color',
      items: connectionColorSchema.options.map((color) => ({
        type: 'item' as const,
        id: `color-${color}`,
        label: color,
        swatch: color,
        checked: record?.color === color,
        run: () => setConnectionColor(row.connectionId, color),
      })),
    },
    {
      type: 'item',
      id: 'readonly',
      label: 'Read-only',
      checked: record?.readOnly ?? false,
      run: async () => {
        if (
          isLive &&
          !window.confirm(
            'This connection is live — changing read-only will reconnect it. Continue?',
          )
        ) {
          return;
        }
        await setConnectionReadOnly(row.connectionId, !(record?.readOnly ?? false));
      },
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'delete',
      label: 'Delete',
      icon: 'trash',
      danger: true,
      run: async () => {
        if (!window.confirm(`Delete connection "${row.name}"?`)) return;
        await deleteConnection(row.connectionId);
      },
    },
  ];
  return items;
}

function containerMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      run: () => refresh(row.connectionId, row.path),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'filters',
      label: 'Filters…',
      icon: 'filter',
      run: () => openFiltersDialog(row.connectionId),
    },
  ];
}

// §8.10's own ordering: Open data / Open data in new tab come first, before Refresh.
function relationMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open-data',
      label: 'Open data',
      icon: 'table',
      run: () => {
        openDataTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: 'open-data-new-tab',
      label: 'Open data in new tab',
      icon: 'table',
      run: () => {
        openDataTab(row.connectionId, row.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      run: () => refresh(row.connectionId, row.path),
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'copy-qualified-name',
      label: 'Copy qualified name',
      icon: 'copy',
      run: () => copyText(qualifiedNameFor(row)),
    },
    {
      type: 'item',
      id: 'count-rows',
      label: 'Count rows',
      icon: 'symbol-numeric',
      // Opens (or reuses) the table's data tab and runs Σ on it — never a bare count with
      // nowhere to show the answer.
      run: () => {
        const tabId = openDataTab(row.connectionId, row.path);
        void runCount(tabId);
      },
    },
    {
      type: 'submenu',
      id: 'saved-filters',
      label: 'Saved filters',
      icon: 'bookmark',
      items: savedFiltersSubmenu(row),
    },
  ];
}

// Reads from the on-demand cache state/tree.ts populates just before the menu opens
// (ProjectTree.vue's onContextMenu) — building this synchronously is what keeps menuForRow()
// itself synchronous.
function savedFiltersSubmenu(row: TreeRowVm): MenuItem[] {
  const saved = treeState.savedQueries[rowKey(row.connectionId, row.path)] ?? [];
  if (saved.length === 0) {
    return [
      {
        type: 'item',
        id: 'saved-filters-empty',
        label: 'No saved filters',
        disabled: true,
        run: () => {},
      },
    ];
  }
  return saved.map((entry) => ({
    type: 'item' as const,
    id: `saved-filter-${entry.id}`,
    label: entry.name,
    run: async () => {
      const tabId = openDataTab(row.connectionId, row.path);
      await setFilter(tabId, entry.body.where);
      await setSort(tabId, entry.body.orderBy);
      await control.queriesTouch(entry.id);
    },
  }));
}

function simpleObjectMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'copy-qualified-name',
      label: 'Copy qualified name',
      icon: 'copy',
      run: () => copyText(qualifiedNameFor(row)),
    },
  ];
}

// The active tab if it already targets this column's table, otherwise open (or reuse) that
// table's data tab first — never silently no-op, and never act on an unrelated tab.
function targetTabFor(row: TreeRowVm): string {
  const tablePath = pathParent(row.path) ?? '';
  const active = activeTab.value;
  if (active && active.connectionId === row.connectionId && active.path === tablePath) {
    return active.id;
  }
  return openDataTab(row.connectionId, tablePath);
}

function columnMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'add-to-projection',
      label: 'Add to projection',
      icon: 'list-selection',
      run: () => {
        const tabId = targetTabFor(row);
        const tab = tabsState.tabs.find((t) => t.id === tabId);
        const current = tab?.state.projection ?? null;
        if (current?.includes(row.name)) return;
        void setProjection(tabId, current ? [...current, row.name] : [row.name]);
      },
    },
    {
      type: 'item',
      id: 'sort-by',
      label: 'Sort by',
      icon: 'sort-precedence',
      run: () => {
        const tabId = targetTabFor(row);
        void setSort(tabId, {
          kind: 'structured',
          terms: [{ column: row.name, direction: 'asc' }],
        });
      },
    },
  ];
}

export function emptyBackgroundMenu(): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'new-connection',
      label: 'New connection',
      icon: 'add',
      run: () => openCreateDialog(),
    },
    {
      type: 'item',
      id: 'refresh-all',
      label: 'Refresh all',
      icon: 'refresh',
      run: () => refreshAllConnections(),
    },
    {
      type: 'item',
      id: 'collapse-all',
      label: 'Collapse all',
      icon: 'collapse-all',
      run: () => collapseAll(),
    },
  ];
}
