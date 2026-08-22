import {
  type ConnectionColor,
  type ConnectionSummary,
  connectionColorSchema,
} from '@shared/connection';
import { decodePath } from '@shared/tree';
import { formatConnectionUri } from '@shared/uri';
import { control } from '../bridge/control';
import type { MenuEntry, MenuItem } from '../workbench/state/contextMenu';
import {
  connectConnection,
  connectionsState,
  disconnectConnection,
  openCreateDialog,
  openEditDialog,
  patchConnection,
  refreshConnections,
} from './state/connections';
import {
  collapseAll,
  openFiltersDialog,
  refresh,
  refreshExpanded,
  type TreeRowVm,
} from './state/tree';
import { openData } from '../workbench/state/tabs';
import { cachedSavedFilters, countRowsFor, scheduleTabRead } from '../workbench/state/filters';
import { activate, updateTabState } from '../workbench/state/tabs';

// The P1 context-menu subset (Step 9b). Items marked (P#) in §8.10 are omitted entirely — not
// rendered disabled — because the feature they open does not exist yet.

const COLORS = connectionColorSchema.options as readonly ConnectionColor[];

function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}

function qualifiedName(path: string): string {
  const segments = decodePath('', path).segments;
  if (segments.length >= 3) {
    return `${segments[segments.length - 2].name}.${segments[segments.length - 1].name}`;
  }
  return segments.length ? segments[segments.length - 1].name : '';
}

function connectionSummary(connectionId: string): ConnectionSummary | null {
  return connectionsState.records.find((r) => r.id === connectionId) ?? null;
}

// §8.10 "Saved filters ▸": lists that path's named saved_queries entries, each opening a new tab
// with that filter applied (D14). Reads from the filter cache (populated by the FilterToolbar's
// history dropdown and by saves); an empty cache shows a disabled placeholder rather than lying.
function savedFilterItems(connectionId: string, path: string): MenuEntry[] {
  const entries = cachedSavedFilters(connectionId, path);
  if (entries.length === 0) {
    return [
      { type: 'item', id: 'no-saved', label: 'No saved filters', disabled: true, run: () => {} },
    ];
  }
  return entries.map(
    (entry): MenuEntry => ({
      type: 'item',
      id: `saved-${entry.id}`,
      label: entry.name,
      run: () => {
        const tab = openData(connectionId, path, { newTab: true });
        updateTabState(tab.id, {
          where: entry.body.where,
          orderBy: entry.body.orderBy,
          cursor: { kind: 'offset', offset: 0 },
          pageIndex: 1,
          totalRows: null,
          totalExact: false,
        });
        activate(tab.id);
        void scheduleTabRead(tab.id);
      },
    }),
  );
}

function isConnected(connectionId: string): boolean {
  const status = connectionsState.states[connectionId]?.status;
  return status === 'connected' || status === 'connecting';
}

function connectionUri(summary: ConnectionSummary): string {
  if (summary.uri) return summary.uri;
  return formatConnectionUri({
    name: summary.name,
    kind: summary.kind,
    color: summary.color,
    readOnly: summary.readOnly,
    host: summary.host,
    port: summary.port,
    database: summary.database,
    username: summary.username,
    password: null,
    options: summary.options,
  });
}

function colorSubmenu(connectionId: string): MenuItem {
  const current = connectionSummary(connectionId)?.color ?? 'grey';
  return {
    type: 'submenu',
    id: 'color',
    label: 'Color',
    icon: 'symbol-color',
    items: COLORS.map(
      (color): MenuEntry => ({
        type: 'item',
        id: `color-${color}`,
        label: color,
        checked: color === current,
        run: () => patchConnection(connectionId, { color }),
      }),
    ),
  };
}

async function removeConnection(connectionId: string): Promise<void> {
  const summary = connectionSummary(connectionId);
  if (!summary) return;
  if (!window.confirm(`Delete connection "${summary.name}"?`)) return;
  await control.connectionsDelete({ id: connectionId });
  await refreshConnections();
}

async function toggleReadOnly(connectionId: string): Promise<void> {
  const summary = connectionSummary(connectionId);
  if (!summary) return;
  if (
    isConnected(connectionId) &&
    !window.confirm('Changing read-only reconnects the connection. Continue?')
  ) {
    return;
  }
  await patchConnection(connectionId, { readOnly: !summary.readOnly });
  if (isConnected(connectionId)) {
    await disconnectConnection(connectionId);
    await connectConnection(connectionId);
  }
}

export function treeRowMenu(row: TreeRowVm): MenuItem[] {
  const { connectionId, node } = row;
  const kind = node.kind;
  const summary = connectionSummary(connectionId);
  const connected = isConnected(connectionId);

  if (kind === 'connection') {
    return [
      connected
        ? {
            type: 'item',
            id: 'disconnect',
            label: 'Disconnect',
            icon: 'debug-disconnect',
            run: () => disconnectConnection(connectionId),
          }
        : {
            type: 'item',
            id: 'connect',
            label: 'Connect',
            icon: 'plug',
            run: () => connectConnection(connectionId),
          },
      {
        type: 'item',
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        run: () => refresh(connectionId, ''),
      },
      {
        type: 'item',
        id: 'edit',
        label: 'Edit…',
        icon: 'edit',
        run: () => openEditDialog(connectionId),
      },
      {
        type: 'item',
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'files',
        run: () => void control.connectionsDuplicate({ id: connectionId }).then(refreshConnections),
      },
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copy(node.name),
      },
      {
        type: 'item',
        id: 'copy-uri',
        label: 'Copy URI',
        icon: 'link',
        run: () => summary && copy(connectionUri(summary)),
      },
      {
        type: 'item',
        id: 'filters',
        label: 'Filters…',
        icon: 'filter',
        run: () => openFiltersDialog(connectionId),
      },
      colorSubmenu(connectionId),
      {
        type: 'item',
        id: 'readonly',
        label: 'Read-only',
        icon: 'lock',
        checked: summary?.readOnly ?? false,
        run: () => toggleReadOnly(connectionId),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'delete',
        label: 'Delete',
        icon: 'trash',
        danger: true,
        run: () => removeConnection(connectionId),
      },
    ];
  }

  if (kind === 'database' || kind === 'schema') {
    return [
      {
        type: 'item',
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        run: () => refresh(connectionId, node.path),
      },
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copy(node.name),
      },
      {
        type: 'item',
        id: 'filters',
        label: 'Filters…',
        icon: 'filter',
        run: () => openFiltersDialog(connectionId),
      },
    ];
  }

  if (kind === 'table' || kind === 'view' || kind === 'matview' || kind === 'routine') {
    return [
      {
        type: 'item',
        id: 'open-data',
        label: 'Open data',
        icon: 'table',
        run: () => openData(connectionId, node.path),
      },
      {
        type: 'item',
        id: 'open-data-new-tab',
        label: 'Open data in new tab',
        icon: 'diff-added',
        run: () => openData(connectionId, node.path, { newTab: true }),
      },
      { type: 'separator' },
      {
        type: 'item',
        id: 'refresh',
        label: 'Refresh',
        icon: 'refresh',
        run: () => refresh(connectionId, node.path),
      },
      {
        type: 'item',
        id: 'count-rows',
        label: 'Count rows',
        icon: 'list-ordered',
        run: () => countRowsFor(connectionId, node.path),
      },
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copy(node.name),
      },
      {
        type: 'item',
        id: 'copy-qualified',
        label: 'Copy qualified name',
        icon: 'copy',
        run: () => copy(qualifiedName(node.path)),
      },
      {
        type: 'submenu',
        id: 'saved-filters',
        label: 'Saved filters',
        icon: 'filter',
        items: savedFilterItems(connectionId, node.path),
      },
    ];
  }

  if (kind === 'sequence' || kind === 'function') {
    return [
      {
        type: 'item',
        id: 'copy-name',
        label: 'Copy name',
        icon: 'copy',
        run: () => copy(node.name),
      },
      {
        type: 'item',
        id: 'copy-qualified',
        label: 'Copy qualified name',
        icon: 'copy',
        run: () => copy(qualifiedName(node.path)),
      },
    ];
  }

  // column
  return [
    { type: 'item', id: 'copy-name', label: 'Copy name', icon: 'copy', run: () => copy(node.name) },
  ];
}

export function treeBackgroundMenu(): MenuItem[] {
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
      run: () => {
        for (const record of connectionsState.records) void refreshExpanded(record.id);
      },
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
