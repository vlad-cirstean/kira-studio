import type { ForeignKeyMeta, ObjectMeta } from '@shared/domain/tree';
import { decodePath } from '@shared/domain/tree';
import { copyText } from '../../clipboard';
import { openDataTab } from '../../state/tabs';
import type { MenuItem } from '../../workbench/state/contextMenu';
import { type Dialect, quoteIdent } from '../shared/sqlIdent';
import {
  type RowSnapshot,
  rowsToCsv,
  rowsToInsert,
  rowsToJson,
  rowsToTsv,
} from './clipboardFormats';
import { duplicateAsInsert, stageNull, toggleDelete } from './pendingChanges';
import { setFilter, setProjection, setSort } from './state';

// Produced locally from the path, never round-tripped to the engine for a string join — the same
// discipline DataGrid.vue's own qualifiedName() and project/menus.ts's qualifiedNameFor use.
const QUALIFIED_KINDS = new Set(['schema', 'table', 'view', 'matview']);
function qualifiedNameForPath(connectionId: string, path: string): string {
  return decodePath(connectionId, path)
    .segments.filter((s) => QUALIFIED_KINDS.has(s.kind))
    .map((s) => s.name)
    .join('.');
}

export interface FkNavContext {
  connectionId: string;
  dialect: Dialect;
  rowValues: Record<string, string | null>;
}

// P7 D1: builds "<refCol> = '<val>' AND ..." for a (possibly composite) FK edge against the
// *target* table's own columns, sourcing values from this row via the edge's own columns. Shared
// by both directions (meta.foreignKeys and meta.referencedBy) since both use the same "my
// columns, their referencedPath/referencedColumns" convention regardless of which populated them.
// Returns null (P7 D2) — never an IS NULL clause — when a needed source value is missing or NULL:
// there is no row to jump to, unlike D5's filter-by-value which treats NULL as a real predicate.
function foreignKeyValueFilter(
  dialect: Dialect,
  columns: string[],
  referencedColumns: string[],
  rowValues: Record<string, string | null>,
): string | null {
  const parts: string[] = [];
  for (let i = 0; i < columns.length; i++) {
    const value = rowValues[columns[i] as string];
    if (value === undefined || value === null) return null;
    parts.push(
      `${quoteIdent(dialect, referencedColumns[i] as string)} = '${value.replace(/'/g, "''")}'`,
    );
  }
  return parts.join(' AND ');
}

// Always a *new* tab (§8.5: "spawns a new tab"), pre-filtered to this row's value(s) on the
// target. No-ops if foreignKeyValueFilter can't build a clause (P7 D2).
function navigateForeignKey(entry: ForeignKeyMeta, ctx: FkNavContext): void {
  const filter = foreignKeyValueFilter(
    ctx.dialect,
    entry.columns,
    entry.referencedColumns,
    ctx.rowValues,
  );
  if (filter === null) return;
  const { id: tabId } = openDataTab(ctx.connectionId, entry.referencedPath, { newTab: true });
  void setFilter(tabId, filter);
}

// P7 D9: ids derive from the constraint's own name (unique per table, stable across reloads) —
// matches the file's existing saved-filter-${id}/menu-item-${col} convention over a counter.
function fkNavItem(idPrefix: string, entry: ForeignKeyMeta, ctx: FkNavContext): MenuItem {
  const label = qualifiedNameForPath(ctx.connectionId, entry.referencedPath);
  return {
    type: 'item',
    id: `${idPrefix}-${entry.name}`,
    label:
      idPrefix === 'go-to-referenced'
        ? `Go to referenced row (${label})`
        : `${label}.${entry.referencedColumns.join(', ')}`,
    icon: idPrefix === 'go-to-referenced' ? 'arrow-right' : 'references',
    disabled:
      foreignKeyValueFilter(ctx.dialect, entry.columns, entry.referencedColumns, ctx.rowValues) ===
      null,
    run: () => navigateForeignKey(entry, ctx),
  };
}

// P7 D1/D3: one item per outbound FK whose own columns include this cell's column — i.e. this
// cell is part of that FK. Shared verbatim by cellMenu() and the grid cell's own nav button
// (DataGrid.vue) so the two can never disagree about what's navigable for a given cell.
export function foreignKeyNavItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: FkNavContext,
): MenuItem[] {
  if (!meta) return [];
  return meta.foreignKeys
    .filter((fk) => fk.columns.includes(columnName))
    .map((fk) => fkNavItem('go-to-referenced', fk, ctx));
}

// Flat "<qualified referencing table>.<col(s)>" items, one per meta.referencedBy entry — shown
// only when columnName is part of the table's primary key. Flat (no submenu wrapper) so the cell
// button's own popup can use it directly; referencedByMenuItems below wraps it for the right-click
// menu.
export function referencedByItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: FkNavContext,
): MenuItem[] {
  if (!meta?.primaryKey?.includes(columnName) || meta.referencedBy.length === 0) return [];
  return meta.referencedBy.map((fk) => fkNavItem('referenced-by', fk, ctx));
}

// P7 D3/D4: referencedByItems, wrapped in a "Referenced by ▸" submenu — [] (not a lone separator)
// when empty, so cellMenu() can always splice this in unconditionally.
export function referencedByMenuItems(
  columnName: string,
  meta: ObjectMeta | null,
  ctx: FkNavContext,
): MenuItem[] {
  const items = referencedByItems(columnName, meta, ctx);
  if (items.length === 0) return [];
  return [
    { type: 'submenu', id: 'referenced-by', label: 'Referenced by', icon: 'references', items },
  ];
}

export interface CellMenuContext {
  tabId: string;
  row: number;
  columnName: string;
  isNull: boolean;
  text: string;
  dialect: Dialect;
  canEdit: boolean;
  isDeleted: boolean;
  startEdit: () => void;
  /** P21 D12: DataGrid.vue's own onPaste — an existing, guarded handler this menu had no row for. */
  onPaste: () => void;
  meta: ObjectMeta | null;
  connectionId: string;
  rowValues: Record<string, string | null>;
}

// D4: Copy / Copy with header / Copy as JSON / Paste / Edit / Set NULL / Filter by this value / Go
// to referenced row / Referenced by (P7).
export function cellMenu(ctx: CellMenuContext): MenuItem[] {
  const editDisabled = !ctx.canEdit || ctx.isDeleted;
  const filterExpr = ctx.isNull
    ? `${quoteIdent(ctx.dialect, ctx.columnName)} IS NULL`
    : `${quoteIdent(ctx.dialect, ctx.columnName)} = '${ctx.text.replace(/'/g, "''")}'`;
  const fkCtx: FkNavContext = {
    connectionId: ctx.connectionId,
    dialect: ctx.dialect,
    rowValues: ctx.rowValues,
  };
  // P7 D4: always-present array, empty sub-arrays disappear on their own — same shape as
  // rowMenu()'s always-present copy-rows submenu below, no extra "anything to show" branch.
  const fkItems = [
    ...foreignKeyNavItems(ctx.columnName, ctx.meta, fkCtx),
    ...referencedByMenuItems(ctx.columnName, ctx.meta, fkCtx),
  ];

  return [
    {
      type: 'item',
      id: 'copy',
      label: 'Copy',
      icon: 'copy',
      // P21 D5: display-only — DataGrid.vue's onKeydown already binds Cmd/Ctrl+C, but its
      // behavior branches on selection kind (cell/range/row/column) in a way one menu row can't
      // express, so this is tagged for its printed key without being dispatched through here.
      shortcut: 'grid.copy',
      run: () => copyText(ctx.isNull ? '' : ctx.text),
    },
    {
      type: 'item',
      id: 'copy-with-header',
      label: 'Copy with header',
      icon: 'copy',
      run: () => copyText(`${ctx.columnName}\n${ctx.isNull ? '' : ctx.text}`),
    },
    {
      type: 'item',
      id: 'copy-as-json',
      label: 'Copy as JSON',
      icon: 'copy',
      run: () => copyText(JSON.stringify(ctx.isNull ? null : ctx.text)),
    },
    {
      type: 'item',
      id: 'paste',
      label: 'Paste',
      icon: 'clippy',
      disabled: !ctx.canEdit,
      shortcut: 'grid.paste',
      run: () => ctx.onPaste(),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'edit',
      label: 'Edit',
      icon: 'edit',
      disabled: editDisabled,
      shortcut: 'grid.edit',
      run: () => ctx.startEdit(),
    },
    {
      type: 'item',
      id: 'set-null',
      label: 'Set NULL',
      disabled: editDisabled,
      run: () => stageNull(ctx.tabId, ctx.row, ctx.columnName),
    },
    {
      type: 'item',
      id: 'filter-by-value',
      label: 'Filter by this value',
      icon: 'filter',
      // Replaces (not appends to) the current filter — a deliberate narrowing action, not an
      // accumulating AND-chain (D5).
      run: () => void setFilter(ctx.tabId, filterExpr),
    },
    ...(fkItems.length ? [{ type: 'separator' } as const, ...fkItems] : []),
  ];
}

export interface RowMenuContext {
  tabId: string;
  rows: number[]; // the acted-on selection — the clicked row alone if it wasn't already selected (D3)
  qualifiedName: string;
  snapshot: (row: number) => RowSnapshot;
  canEdit: boolean;
}

// D6: Copy row(s) ▸ TSV/CSV/JSON/INSERT, Duplicate row(s), Delete row(s) — all three act on the
// full row selection.
export function rowMenu(ctx: RowMenuContext): MenuItem[] {
  const snapshots = ctx.rows.map(ctx.snapshot);
  return [
    {
      type: 'submenu',
      id: 'copy-rows',
      label: 'Copy row(s)',
      icon: 'copy',
      items: [
        {
          type: 'item',
          id: 'copy-rows-tsv',
          label: 'TSV',
          // Display-only (P21 D5) — the row-selection branch of DataGrid.vue's onCopy already
          // produces this exact TSV output on Cmd/Ctrl+C.
          shortcut: 'grid.copy',
          run: () => copyText(rowsToTsv(snapshots)),
        },
        {
          type: 'item',
          id: 'copy-rows-csv',
          label: 'CSV',
          run: () => copyText(rowsToCsv(snapshots)),
        },
        {
          type: 'item',
          id: 'copy-rows-json',
          label: 'JSON',
          run: () => copyText(rowsToJson(snapshots)),
        },
        {
          type: 'item',
          id: 'copy-rows-insert',
          label: 'INSERT',
          run: () => copyText(rowsToInsert(ctx.qualifiedName, snapshots)),
        },
      ],
    },
    {
      type: 'item',
      id: 'duplicate-row',
      label: 'Duplicate row(s)',
      icon: 'copy',
      disabled: !ctx.canEdit,
      shortcut: 'grid.duplicateRows',
      run: () => {
        for (const row of ctx.rows) duplicateAsInsert(ctx.tabId, row);
      },
    },
    {
      type: 'item',
      id: 'delete-row',
      label: 'Delete row(s)',
      icon: 'trash',
      danger: true,
      disabled: !ctx.canEdit,
      shortcut: 'grid.deleteRows',
      run: () => toggleDelete(ctx.tabId, ctx.rows),
    },
  ];
}

export interface HeaderMenuContext {
  tabId: string;
  columnName: string;
  currentSort: 'asc' | 'desc' | null;
  currentProjection: string[] | null;
  allColumnNames: string[];
  columnValues: () => string[]; // the loaded page's values only (§8.5's own scope boundary)
}

// D7: Sort asc/desc/Clear sort, Hide column/Show all columns, Copy column name/values.
export function headerMenu(ctx: HeaderMenuContext): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'sort-asc',
      label: 'Sort asc',
      run: () =>
        void setSort(ctx.tabId, {
          kind: 'structured',
          terms: [{ column: ctx.columnName, direction: 'asc' }],
        }),
    },
    {
      type: 'item',
      id: 'sort-desc',
      label: 'Sort desc',
      run: () =>
        void setSort(ctx.tabId, {
          kind: 'structured',
          terms: [{ column: ctx.columnName, direction: 'desc' }],
        }),
    },
    {
      type: 'item',
      id: 'clear-sort',
      label: 'Clear sort',
      disabled: ctx.currentSort === null,
      run: () => void setSort(ctx.tabId, null),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'hide-column',
      label: 'Hide column',
      // D8: reuses the same setProjection() ColumnsMenu.vue calls — no second, competing
      // "which columns are shown" mechanism.
      run: () => {
        const current = ctx.currentProjection ?? ctx.allColumnNames;
        void setProjection(
          ctx.tabId,
          current.filter((c) => c !== ctx.columnName),
        );
      },
    },
    {
      type: 'item',
      id: 'show-all-columns',
      label: 'Show all columns',
      run: () => void setProjection(ctx.tabId, null),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'copy-column-name',
      label: 'Copy column name',
      icon: 'copy',
      run: () => copyText(ctx.columnName),
    },
    {
      type: 'item',
      id: 'copy-column-values',
      label: 'Copy column values',
      icon: 'copy',
      // Display-only (P21 D5): onHeaderContextMenu sets a `column` selection before this menu
      // opens, and onCopy's final branch already copies that column's loaded values on
      // Cmd/Ctrl+C — a binding that worked before this phase but was never shown anywhere.
      shortcut: 'grid.copy',
      run: () => copyText(ctx.columnValues().join('\n')),
    },
  ];
}
