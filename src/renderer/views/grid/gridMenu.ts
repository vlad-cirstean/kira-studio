import { copyText } from '../../clipboard';
import type { MenuItem } from '../../workbench/state/contextMenu';
import {
  type RowSnapshot,
  rowsToCsv,
  rowsToInsert,
  rowsToJson,
  rowsToTsv,
} from './clipboardFormats';
import { duplicateAsInsert, stageNull, toggleDelete } from './pendingChanges';
import { setFilter, setProjection, setSort } from './state';

type Dialect = 'postgres' | 'mariadb' | undefined;

// D5: builds "<col> = '<escaped>'" (Postgres) / "`<col>` = '<escaped>'" (MariaDB), or IS NULL —
// the same trust boundary as the toolbar's own free-text WHERE box (never validated against the
// column's type, generated as literal SQL text once).
function quoteIdent(dialect: Dialect, name: string): string {
  if (dialect === 'mariadb') return `\`${name.replace(/`/g, '``')}\``;
  return `"${name.replace(/"/g, '""')}"`;
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
}

// D4: Copy / Copy with header / Copy as JSON / Edit / Set NULL / Filter by this value.
// "Go to referenced row" is deliberately omitted — it needs FK metadata, P7's deliverable.
export function cellMenu(ctx: CellMenuContext): MenuItem[] {
  const editDisabled = !ctx.canEdit || ctx.isDeleted;
  const filterExpr = ctx.isNull
    ? `${quoteIdent(ctx.dialect, ctx.columnName)} IS NULL`
    : `${quoteIdent(ctx.dialect, ctx.columnName)} = '${ctx.text.replace(/'/g, "''")}'`;

  return [
    {
      type: 'item',
      id: 'copy',
      label: 'Copy',
      icon: 'copy',
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
    { type: 'separator' },
    {
      type: 'item',
      id: 'edit',
      label: 'Edit',
      icon: 'edit',
      disabled: editDisabled,
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
      run: () => copyText(ctx.columnValues().join('\n')),
    },
  ];
}
