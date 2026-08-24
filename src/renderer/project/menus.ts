import { connectionColorSchema } from '@shared/domain/connection';
import { decodePath } from '@shared/domain/tree';
import { formatConnectionUri } from '@shared/domain/uri';
import { control } from '../bridge/control';
import { copyText } from '../clipboard';
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
import { consoleDefaultFor, setConsoleDefault } from '../state/consoleDefaults';
import {
  activeTab,
  findDataTab,
  openConsoleTab,
  openDataTab,
  openDefinitionTab,
  openDocumentTab,
  openKeyValueTab,
  openStreamTab,
} from '../state/tabs';
import { runCount as runDocumentCount } from '../views/documents/state';
import { runCount, setFilter, setProjection, setSort } from '../views/grid/state';
import type { MenuItem } from '../workbench/state/contextMenu';
import { nodeIcon } from './icons';
import {
  collapseAll,
  groupParentPath,
  openFiltersDialog,
  refresh,
  refreshAllConnections,
  rowKey,
  type TreeRowVm,
  treeState,
} from './state/tree';

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
function qualifiedNameFor(row: TreeRowVm): string {
  const decoded = decodePath(row.connectionId, row.path);
  return decoded.segments
    .filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

export function menuForRow(row: TreeRowVm): MenuItem[] {
  switch (row.kind) {
    case 'group':
      return groupMenu(row);
    case 'connection':
      return connectionMenu(row);
    case 'database':
    case 'schema':
      return containerMenu(row);
    case 'table':
    case 'view':
    case 'matview':
      return relationMenu(row);
    case 'collection':
      return collectionMenu(row);
    case 'namespace':
    case 'prefix':
      return namespaceMenu(row);
    case 'key':
      return keyMenu(row);
    case 'bucket':
      return containerMenu(row);
    case 'object':
      return objectMenu(row);
    case 'topic':
    case 'queue':
      return streamNodeMenu(row);
    case 'partition':
    case 'consumerGroup':
      return simpleObjectMenu(row);
    case 'sequence':
    case 'function':
      return simpleObjectMenu(row);
    default:
      return [];
  }
}

// D5: offered only when the connection's caps say so, same discipline as "Open definition" — shared by
// all three menu builders below rather than repeated per-row-kind gating logic.
function consoleMenuItem(row: TreeRowVm): MenuItem[] {
  if (connectionsState.states[row.connectionId]?.caps?.sql !== true) return [];
  return [
    {
      type: 'item',
      id: 'open-console',
      label: 'Open query console',
      icon: 'terminal',
      run: () => {
        openConsoleTab(row.connectionId, row.path);
      },
    },
  ];
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
      shortcut: 'tree.rename',
      run: () => openEditDialog(row.connectionId),
    },
    {
      type: 'item',
      id: 'duplicate',
      label: 'Duplicate',
      icon: 'copy',
      shortcut: 'tree.duplicate',
      run: async () => {
        await duplicateConnection(row.connectionId);
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'copy-uri',
      label: 'Copy URI',
      icon: 'link',
      shortcut: 'tree.copyUri',
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
    ...consoleMenuItem(row),
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
      shortcut: 'tree.delete',
      run: async () => {
        if (!window.confirm(`Delete connection "${row.name}"?`)) return;
        await deleteConnection(row.connectionId);
      },
    },
  ];
  return items;
}

// D9: Postgres-only — MariaDB's console can already switch database with its own `USE db;` as
// the console's first statement, so there is nothing for this item to do there.
function setAsDefaultMenuItem(row: TreeRowVm): MenuItem[] {
  const record = connectionsState.records.find((r) => r.id === row.connectionId);
  if (record?.kind !== 'postgres') return [];
  return [
    {
      type: 'item',
      id: 'set-as-default',
      label: 'Set as default',
      icon: 'star',
      checked: consoleDefaultFor(row.connectionId) === row.path,
      run: () => setConsoleDefault(row.connectionId, row.path),
    },
  ];
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
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
    {
      type: 'item',
      id: 'filters',
      label: 'Filters…',
      icon: 'filter',
      run: () => openFiltersDialog(row.connectionId),
    },
    ...consoleMenuItem(row),
    ...setAsDefaultMenuItem(row),
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
      // Display-only (P21 D5): Enter fires ProjectTree.vue's onOpen(row) directly (the same
      // action double-click performs), not this run() via runMenuShortcut.
      shortcut: 'tree.open',
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
    // D5: offered only when the connection's caps say so — never a permanently disabled row.
    ...(connectionsState.states[row.connectionId]?.caps?.definition === true
      ? [
          {
            type: 'item' as const,
            id: 'open-definition',
            label: 'Open definition',
            icon: 'file-code',
            run: () => {
              openDefinitionTab(row.connectionId, row.path);
            },
          },
        ]
      : []),
    ...consoleMenuItem(row),
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
      shortcut: 'tree.copyName',
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
        const { id: tabId } = openDataTab(row.connectionId, row.path);
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

// P8's collection row: near-copy of relationMenu, opening a 'document' tab instead of 'data' —
// gains "Open definition" as of P19 D12 (Caps.definition === true for mongo). No saved-filters
// submenu (§8.10 names one for "Table / view / collection" generally, but a saved query body is
// a SQL WHERE/ORDER BY shape that has no Mongo-filter analog yet).
function collectionMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open-document',
      label: 'Open',
      icon: 'json',
      shortcut: 'tree.open',
      run: () => {
        openDocumentTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: 'open-document-new-tab',
      label: 'Open in new tab',
      icon: 'json',
      run: () => {
        openDocumentTab(row.connectionId, row.path, { newTab: true });
      },
    },
    // D5: offered only when the connection's caps say so — never a permanently disabled row.
    ...(connectionsState.states[row.connectionId]?.caps?.definition === true
      ? [
          {
            type: 'item' as const,
            id: 'open-definition',
            label: 'Open definition',
            icon: 'file-code',
            run: () => {
              openDefinitionTab(row.connectionId, row.path);
            },
          },
        ]
      : []),
    ...consoleMenuItem(row),
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
      shortcut: 'tree.copyName',
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
      id: 'count-documents',
      label: 'Count documents',
      icon: 'symbol-numeric',
      run: () => {
        const { id: tabId } = openDocumentTab(row.connectionId, row.path);
        void runDocumentCount(tabId);
      },
    },
  ];
}

// P19 D2's synthetic folder row: nothing that needs a real node behind it — Refresh reloads the
// *parent* (the folder is just a view over that listing, so this is the only way to refresh what
// it shows), Collapse all is the same global action every other row's menu omits but the tree
// background menu offers, included here because a folder is the row most likely to be right-
// clicked specifically to declutter a crowded schema.
function groupMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'refresh',
      label: 'Refresh',
      icon: 'refresh',
      run: () => refresh(row.connectionId, groupParentPath(row.path)),
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

// P9's namespace level (redis's ':'-delimited container) and P17's S3 prefix ("folder") level:
// same shape either way — a plain intermediate container, no console-default/filters affordance
// (those are SQL-specific) — minimal, per the read-only scope decision (D2/D14).
function namespaceMenu(row: TreeRowVm): MenuItem[] {
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
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
  ];
}

// P9's key leaf: minimal open/copy-name only (D14) — no edit/delete rows anywhere, per the
// read-only scope decision (D2). No separate "copy qualified name": a key node's `name` is
// already the complete literal Redis key (D3), so it would just duplicate "Copy name".
function keyMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open-keyvalue',
      label: 'Open',
      icon: 'symbol-key',
      shortcut: 'tree.open',
      run: () => {
        openKeyValueTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: 'open-keyvalue-new-tab',
      label: 'Open in new tab',
      icon: 'symbol-key',
      run: () => {
        openKeyValueTab(row.connectionId, row.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
  ];
}

// P17's S3 object leaf: same shape as keyMenu (open/open-in-new-tab/copy-name, no edit/delete —
// caps.canUpdate/canDelete are both false for S3 this phase). No separate "copy qualified name"
// either, for the same reason keyMenu skips it: an object node's `name` is already the full S3
// key verbatim (s3/catalog.ts, mirroring keyMenu's own key-name reasoning), so it would just
// duplicate "Copy name".
function objectMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open-keyvalue',
      label: 'Open',
      icon: nodeIcon(row.kind),
      shortcut: 'tree.open',
      run: () => {
        openKeyValueTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: 'open-keyvalue-new-tab',
      label: 'Open in new tab',
      icon: nodeIcon(row.kind),
      run: () => {
        openKeyValueTab(row.connectionId, row.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
    },
  ];
}

// P10's topic/queue leaf: minimal open/copy-name only (D13), same discipline as keyMenu — no
// edit/delete rows anywhere, per the read-only scope decision.
function streamNodeMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'open-stream',
      label: 'Open',
      icon: nodeIcon(row.kind),
      shortcut: 'tree.open',
      run: () => {
        openStreamTab(row.connectionId, row.path);
      },
    },
    {
      type: 'item',
      id: 'open-stream-new-tab',
      label: 'Open in new tab',
      icon: nodeIcon(row.kind),
      run: () => {
        openStreamTab(row.connectionId, row.path, { newTab: true });
      },
    },
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      shortcut: 'tree.copyName',
      run: () => copyText(row.name),
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
      const { id: tabId } = openDataTab(row.connectionId, row.path);
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
      shortcut: 'tree.copyName',
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

// D9: the definition view's Columns section reuses the tree's former column-row menu items, but it
// already has the table's own path directly (`tab.path`) — no `pathParent()` needed the way the
// tree's former column rows required.
function targetTabForTable(connectionId: string, tablePath: string): string {
  const active = activeTab.value;
  if (active && active.connectionId === connectionId && active.path === tablePath) {
    return active.id;
  }
  return openDataTab(connectionId, tablePath).id;
}

export function columnsSectionMenu(
  connectionId: string,
  tablePath: string,
  columnName: string,
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(columnName),
    },
    {
      type: 'item',
      id: 'add-to-projection',
      label: 'Add to projection',
      icon: 'list-selection',
      run: () => {
        const tabId = targetTabForTable(connectionId, tablePath);
        const tab = findDataTab(tabId);
        const current = tab?.state.projection ?? null;
        if (current?.includes(columnName)) return;
        void setProjection(tabId, current ? [...current, columnName] : [columnName]);
      },
    },
    {
      type: 'item',
      id: 'sort-by',
      label: 'Sort by',
      icon: 'sort-precedence',
      run: () => {
        const tabId = targetTabForTable(connectionId, tablePath);
        void setSort(tabId, {
          kind: 'structured',
          terms: [{ column: columnName, direction: 'asc' }],
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
      shortcut: 'app.newConnection',
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
