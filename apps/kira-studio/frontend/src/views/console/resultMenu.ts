import { beautifyJson } from '../../beautify';
import { copyText } from '../../clipboard';
import type { MenuItem } from '../../state/contextMenu';
import {
  columnsToTsv,
  type RowSnapshot,
  rowsToCsv,
  rowsToJson,
  rowsToTsv,
} from '../shared/clipboardFormats';

// P19 D9/D10: the console result grid's own menu builders, mirroring views/grid/menu.ts's split
// (builders in a plain module, the host only opens them) -- item ids follow that file's own
// naming (copy, copy-with-header, copy-as-json, copy-rows, copy-rows-tsv, ...) so a reader
// comparing the two surfaces sees the same vocabulary. Unlike the data grid, a console result is
// read-only by construction (no edit/delete/paste/duplicate -- every one of those writes, and a
// console result has no addressable table) and offers no "Copy as INSERT" (no qualified table
// name to write into, D9).

export interface TabularCellMenuContext {
  columnName: string;
  isNull: boolean;
  text: string;
}

// D9's 'cell' row: Copy / Copy with header / Copy as JSON, the same three the data grid's own
// cellMenu leads with.
export function tabularCellMenu(ctx: TabularCellMenuContext): MenuItem[] {
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
  ];
}

export interface TabularRangeMenuContext {
  rows: readonly number[];
  cols: readonly number[];
  /** column names in the same order as `cols`, for the CSV/JSON forms' own header row. */
  columnNames: readonly string[];
  cellAt: (row: number, col: number) => { text: string; isNull: boolean };
}

function rangeSnapshots(ctx: TabularRangeMenuContext): RowSnapshot[] {
  return ctx.rows.map((row) => {
    const values: Record<string, string | null> = {};
    ctx.cols.forEach((col, i) => {
      const dc = ctx.cellAt(row, col);
      values[ctx.columnNames[i] as string] = dc.isNull ? null : dc.text;
    });
    return { columns: [...ctx.columnNames], values };
  });
}

// D9's 'range' row: Copy (TSV, the same text ⌘C already produces) · Copy as CSV · Copy as JSON.
export function tabularRangeMenu(ctx: TabularRangeMenuContext): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy',
      label: 'Copy',
      icon: 'copy',
      run: () => copyText(columnsToTsv(ctx.rows, ctx.cols, ctx.cellAt)),
    },
    {
      type: 'item',
      id: 'copy-as-csv',
      label: 'Copy as CSV',
      icon: 'copy',
      run: () => copyText(rowsToCsv(rangeSnapshots(ctx))),
    },
    {
      type: 'item',
      id: 'copy-as-json',
      label: 'Copy as JSON',
      icon: 'copy',
      run: () => copyText(rowsToJson(rangeSnapshots(ctx))),
    },
  ];
}

export interface TabularRowMenuContext {
  snapshots: RowSnapshot[];
}

// D9's 'row' row: Copy rows ▸ TSV/CSV/JSON. No INSERT -- a console result comes from ad-hoc SQL
// with no addressable table to write into.
export function tabularRowMenu(ctx: TabularRowMenuContext): MenuItem[] {
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
          run: () => copyText(rowsToTsv(ctx.snapshots)),
        },
        {
          type: 'item',
          id: 'copy-rows-csv',
          label: 'CSV',
          run: () => copyText(rowsToCsv(ctx.snapshots)),
        },
        {
          type: 'item',
          id: 'copy-rows-json',
          label: 'JSON',
          run: () => copyText(rowsToJson(ctx.snapshots)),
        },
      ],
    },
  ];
}

export interface TabularColumnMenuContext {
  columnName: string;
  rows: readonly number[];
  col: number;
  cellAt: (row: number, col: number) => { text: string; isNull: boolean };
}

// D9's 'column' row: Copy column (the exact TSV ⌘C already produces for a one-column selection)
// and Copy column name.
export function tabularColumnMenu(ctx: TabularColumnMenuContext): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-column',
      label: 'Copy column',
      icon: 'copy',
      run: () => copyText(columnsToTsv(ctx.rows, [ctx.col], ctx.cellAt)),
    },
    {
      type: 'item',
      id: 'copy-column-name',
      label: 'Copy column name',
      run: () => copyText(ctx.columnName),
    },
  ];
}

// D6: the row's body -- already canonical extended JSON (a Mongo document) or built fresh (a
// Redis key/value pair) -- re-indented through beautify.ts's JSON scanner, falling back to the
// raw text if it does not scan (a truncated body, say).
function prettyJson(text: string): string {
  const r = beautifyJson(text, 'indented');
  return r.ok ? r.text : text;
}

function indented(text: string): string {
  return text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
}

// D6's own "copy all" shape: `[` + every row's (already-pretty) text, comma-joined + `]` -- a
// plain textual assembly, not a re-parse-and-restringify, so a row whose own text doesn't happen
// to scan still lands in the array unindented rather than dropping it.
function jsonArrayOf(items: readonly string[]): string {
  return `[\n${items.map((item) => indented(item)).join(',\n')}\n]`;
}

async function copyOrReportError(text: string, onError: (message: string) => void): Promise<void> {
  try {
    await copyText(text);
  } catch (err) {
    onError(err instanceof Error ? err.message : String(err));
  }
}

export interface RowJsonMenuContext {
  /** This row's own value, pre-formatted JSON text (a document's raw EJSON body, or a kv pair
   *  already run through JSON.stringify). */
  json: string;
  /** Every displayed row's JSON text, in display order -- "all" means what's on screen right now
   *  (an active find-filter's own subset), never every row the server could return. */
  allJson: readonly string[];
  onError: (message: string) => void;
}

// D6/D11: the document and key-value result branches' own row menu -- "Copy as JSON" (this row)
// and "Copy all as JSON" (every displayed row). Both go through copyOrReportError since a
// clipboard write here can genuinely be rejected and ContextMenu.vue's own `@click` never awaits
// `run()` -- documents/menu.ts's copyOrReportError shape, P13 D9's strip precedent.
export function rowAsJsonMenu(ctx: RowJsonMenuContext): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'copy-as-json',
      label: 'Copy as JSON',
      icon: 'copy',
      run: () => copyOrReportError(prettyJson(ctx.json), ctx.onError),
    },
    {
      type: 'item',
      id: 'copy-all-as-json',
      label: 'Copy all as JSON',
      icon: 'copy',
      run: () => copyOrReportError(jsonArrayOf(ctx.allJson.map(prettyJson)), ctx.onError),
    },
  ];
}
