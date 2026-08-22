import { connectionColorSchema } from '@shared/domain/connection';
import { decodePath } from '@shared/domain/tree';
import { formatConnectionUri } from '@shared/domain/uri';
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
import type { MenuItem } from '../workbench/state/contextMenu';
import {
  collapseAll,
  openFiltersDialog,
  refresh,
  refreshAllConnections,
  type TreeRowVm,
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

function relationMenu(row: TreeRowVm): MenuItem[] {
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
      id: 'copy-qualified-name',
      label: 'Copy qualified name',
      icon: 'copy',
      run: () => copyText(qualifiedNameFor(row)),
    },
  ];
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

function columnMenu(row: TreeRowVm): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-name',
      label: 'Copy name',
      icon: 'copy',
      run: () => copyText(row.name),
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
