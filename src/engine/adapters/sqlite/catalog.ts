import { basename } from 'node:path';
import {
  type ColumnMeta,
  encodePath,
  type ForeignKeyMeta,
  type IndexMeta,
  type TreeNode,
} from '../../../shared/domain/tree';
import type { SqliteParam } from './query';

// Every function takes an `exec` rather than a handle directly, so every catalog query is routed
// through query.ts's runQuery — command-logged and cancellation-checked like any other query.
// F17: every catalog query here binds the table/index name as a real parameter to a table-valued
// pragma function (`pragma_table_xinfo(?)`, not `PRAGMA table_xinfo(name)`) — never an
// interpolated identifier. Adapter rule 7 holds in an even stronger form than the other SQL
// adapters' information_schema-bound-parameter discipline: this is a genuine bound parameter, not
// a string comparison inside a catalog query.
export type QueryExecutor = <T = Record<string, unknown>>(
  sql: string,
  params?: SqliteParam[],
) => T[];

interface DatabaseListRow {
  seq: number;
  name: string;
  file: string;
}

// D19: the tree's one "schema" level, read from `PRAGMA database_list` rather than hardcoded —
// the honest source, and it costs one pragma. `temp` is always present and never has anything a
// user put there; Kira never issues ATTACH, so in practice this is always exactly one `main` row.
export function listDatabases(exec: QueryExecutor): TreeNode[] {
  const rows = exec<DatabaseListRow>('PRAGMA database_list', []);
  return rows
    .filter((r) => r.name !== 'temp')
    .map((row) => ({
      kind: 'database' as const,
      name: row.name,
      path: encodePath([{ kind: 'database', name: row.name }]),
      hasChildren: true,
      detail: row.file ? basename(row.file) : undefined,
    }));
}

interface TableListRow {
  schema: string;
  name: string;
  type: 'table' | 'view' | 'virtual' | 'shadow';
  ncol: number;
  wr: number;
  strict: number;
}

// F17/F24: a `shadow` row is FTS5/RTREE/etc.'s own internal bookkeeping table — never shown, the
// same discipline mysql-family/catalog.ts applies to information_schema/performance_schema/mysql/
// sys. `sqlite_`-prefixed names (sqlite_schema, sqlite_sequence, ...) are SQLite's own, hidden the
// same way. A `virtual` table (FTS5, RTREE, ...) reads through SELECT like any other and is shown
// as a plain table.
function relevantTables(exec: QueryExecutor, schema: string): TableListRow[] {
  const rows = exec<TableListRow>('PRAGMA table_list', []);
  return rows.filter(
    (r) => r.schema === schema && r.type !== 'shadow' && !r.name.startsWith('sqlite_'),
  );
}

interface Stat1Row {
  tbl: string;
  stat: string;
}

// F20: sqlite_stat1 only exists after ANALYZE, and — a real quirk, not an assumption — a table
// with at least one index gets *no* `idx IS NULL` row at all; its row count instead has to be read
// off any one of its indexes' own stat (every non-partial index has exactly one entry per row, so
// its first token is the table's row count too). Taking the max across every stat1 row for a table
// is correct either way: a bare table row is exact, a full index's row is exact, and a partial
// index's row can only ever be an undercount, never an overcount.
function loadRowEstimates(exec: QueryExecutor): Map<string, number> {
  const rows = exec<Stat1Row>('SELECT tbl, stat FROM sqlite_stat1', []);
  const byTable = new Map<string, number>();
  for (const row of rows) {
    const n = Number.parseInt(row.stat.split(' ')[0] ?? '', 10);
    if (!Number.isFinite(n)) continue;
    const prev = byTable.get(row.tbl);
    if (prev === undefined || n > prev) byTable.set(row.tbl, n);
  }
  return byTable;
}

// describe()'s single-table counterpart to loadRowEstimates' bulk fetch — same max-across-stat1-
// rows logic (F20), scoped to one table rather than every table in the schema.
export function getRowEstimateFor(exec: QueryExecutor, table: string): number | null {
  const rows = exec<Stat1Row>('SELECT tbl, stat FROM sqlite_stat1 WHERE tbl = ?', [table]);
  const counts = rows
    .map((r) => Number.parseInt(r.stat.split(' ')[0] ?? '', 10))
    .filter((n) => Number.isFinite(n));
  return counts.length ? Math.max(...counts) : null;
}

// §5.1: database -> tables/views -> column. No routine level (SQLite has no stored routines) and
// no sequence kind (SQLite has no SEQUENCE engine) — a leaner tree than either MariaDB's or MySQL's.
export function listTablesAndViews(exec: QueryExecutor, schema: string): TreeNode[] {
  const tables = relevantTables(exec, schema);
  const estimates = loadRowEstimates(exec);

  return tables
    .sort((a, b) => {
      const rank = (t: TableListRow['type']) => (t === 'view' ? 1 : 0);
      const r = rank(a.type) - rank(b.type);
      return r !== 0 ? r : a.name.localeCompare(b.name);
    })
    .map((row) => {
      const kind = row.type === 'view' ? ('view' as const) : ('table' as const);
      const estimate = kind === 'table' ? (estimates.get(row.name) ?? null) : null;
      return {
        kind,
        name: row.name,
        path: encodePath([
          { kind: 'database', name: schema },
          { kind, name: row.name },
        ]),
        // P19 D5: every relation is a leaf — a table/view's columns live in the definition view.
        hasChildren: false,
        detail: estimate !== null ? `~${estimate.toLocaleString()} rows` : undefined,
      };
    });
}

interface TableXInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
  hidden: number;
}

// F18: `table_xinfo`, not `table_info` — the latter omits generated columns that `SELECT *` still
// returns, which would make this adapter's own projection silently disagree with the table.
// hidden 1 marks a virtual table's shadow-only column (excluded, `SELECT *` excludes it too);
// hidden 0/2/3 (ordinary / VIRTUAL generated / STORED generated) are all real, selectable columns.
export function listColumns(exec: QueryExecutor, table: string): ColumnMeta[] {
  const rows = exec<TableXInfoRow>('SELECT * FROM pragma_table_xinfo(?)', [table]);
  return rows
    .filter((r) => r.hidden !== 1)
    .map((r) => ({
      name: r.name,
      position: r.cid,
      dataType: r.type,
      nullable: r.notnull === 0,
      defaultExpr: r.dflt_value,
      isPrimaryKey: r.pk > 0,
      comment: null, // SQLite has no column-comment concept
    }));
}

// The `pk` ordinal is 1-based and always present on table_xinfo, unlike the other SQL adapters —
// a single-column INTEGER PRIMARY KEY (the rowid alias) has no backing index at all (verified: no
// autoindex, no index_list row), so this is read directly rather than derived from listIndexes.
export function primaryKeyFromColumns(
  columns: ColumnMeta[],
  rawRows: TableXInfoRow[],
): string[] | null {
  const pkRows = rawRows.filter((r) => r.pk > 0).sort((a, b) => a.pk - b.pk);
  if (pkRows.length === 0) return null;
  const known = new Set(columns.map((c) => c.name));
  return pkRows.map((r) => r.name).filter((name) => known.has(name));
}

interface IndexListRow {
  seq: number;
  name: string;
  unique: number;
  origin: 'c' | 'u' | 'pk';
  partial: number;
}

interface IndexInfoRow {
  seqno: number;
  cid: number;
  name: string | null;
}

export function listIndexes(exec: QueryExecutor, table: string): IndexMeta[] {
  const indexes = exec<IndexListRow>('SELECT * FROM pragma_index_list(?)', [table]);
  return indexes.map((idx) => {
    const infoRows = exec<IndexInfoRow>('SELECT * FROM pragma_index_info(?)', [idx.name]);
    return {
      name: idx.name,
      columns: infoRows.map((r) => r.name).filter((n): n is string => n !== null),
      unique: idx.unique === 1,
      primary: idx.origin === 'pk',
      // SQLite reports no index method via any pragma — always a B-tree internally, but there is
      // nothing honest to put here beyond null (unlike MariaDB's INDEX_TYPE).
      method: null,
    };
  });
}

interface ForeignKeyListRow {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
}

// F17: `foreign_key_list` never reports the constraint's own name, even when the SQL declared one
// with `CONSTRAINT name FOREIGN KEY (...)` — SQLite simply drops it. A name is synthesized from
// the table and its first referencing column, Postgres's own convention for an unnamed FK
// (`<table>_<column>_fkey`), grouped by the pragma's own `id`.
function synthesizeFkName(table: string, firstColumn: string): string {
  return `${table}_${firstColumn}_fkey`;
}

export function listForeignKeys(
  exec: QueryExecutor,
  schema: string,
  table: string,
): ForeignKeyMeta[] {
  const rows = exec<ForeignKeyListRow>('SELECT * FROM pragma_foreign_key_list(?)', [table]);
  const byId = new Map<number, ForeignKeyListRow[]>();
  for (const row of rows) {
    const group = byId.get(row.id);
    if (group) group.push(row);
    else byId.set(row.id, [row]);
  }
  return [...byId.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.seq - b.seq);
    return {
      name: synthesizeFkName(table, sorted[0].from),
      columns: sorted.map((r) => r.from),
      referencedPath: encodePath([
        { kind: 'database', name: schema },
        { kind: 'table', name: sorted[0].table },
      ]),
      referencedColumns: sorted.map((r) => r.to),
      onDelete: sorted[0].on_delete,
      onUpdate: sorted[0].on_update,
    };
  });
}

// F17/D20: SQLite has no reverse-FK index, so this scans every other relevant table's own
// foreign_key_list looking for one that points back at `table` — one bounded pragma per table in
// the schema, on the describe()/definition() path only, never on tree expansion. `allTables`
// includes `table` itself on purpose: a self-referencing FK (the employees.manager_id case) must
// appear here too, pointing at itself, mirroring listForeignKeys's own outbound entry for it.
export function listReferencedBy(
  exec: QueryExecutor,
  schema: string,
  table: string,
  allTables: string[],
): ForeignKeyMeta[] {
  const result: ForeignKeyMeta[] = [];
  for (const source of allTables) {
    const rows = exec<ForeignKeyListRow>('SELECT * FROM pragma_foreign_key_list(?)', [source]);
    const byId = new Map<number, ForeignKeyListRow[]>();
    for (const row of rows) {
      if (row.table !== table) continue;
      const group = byId.get(row.id);
      if (group) group.push(row);
      else byId.set(row.id, [row]);
    }
    for (const group of byId.values()) {
      const sorted = [...group].sort((a, b) => a.seq - b.seq);
      result.push({
        name: synthesizeFkName(source, sorted[0].from),
        columns: sorted.map((r) => r.to),
        referencedPath: encodePath([
          { kind: 'database', name: schema },
          { kind: 'table', name: source },
        ]),
        referencedColumns: sorted.map((r) => r.from),
        onDelete: sorted[0].on_delete,
        onUpdate: sorted[0].on_update,
      });
    }
  }
  return result;
}

export function listAllTableNames(exec: QueryExecutor, schema: string): string[] {
  return relevantTables(exec, schema)
    .filter((r) => r.type !== 'view')
    .map((r) => r.name);
}

export interface ReadTarget {
  qualifiedName: { schema: string; table: string };
  columns: ColumnMeta[];
  primaryKey: string[] | null;
  /** Unique indexes whose columns are all NOT NULL — keyset tiebreaker candidates. */
  uniqueKeys: string[][];
  /** F23/D22: 'rowid' (or one of its two aliases, whichever isn't shadowed by a real column) for
   *  a rowid table with no explicit primary key candidate of its own; null for a view, a WITHOUT
   *  ROWID table, or the rare table that shadows all three rowid aliases. Never mutation identity
   *  (D23) — purely an internal keyset tiebreaker. */
  rowidColumn: string | null;
}

const ROWID_ALIASES = ['rowid', '_rowid_', 'oid'];

function pickRowidColumn(columns: ColumnMeta[], isRowidTable: boolean): string | null {
  if (!isRowidTable) return null;
  const used = new Set(columns.map((c) => c.name.toLowerCase()));
  return ROWID_ALIASES.find((alias) => !used.has(alias)) ?? null;
}

// The read path needs the relation's columns/PK/unique-index/rowid shape in one shot, resolved
// fresh on every uncached read (same discipline as the other SQL adapters' getReadTarget).
export function getReadTarget(exec: QueryExecutor, schema: string, table: string): ReadTarget {
  const rawColumns = exec<TableXInfoRow>('SELECT * FROM pragma_table_xinfo(?)', [table]);
  const columns = rawColumns
    .filter((r) => r.hidden !== 1)
    .map((r) => ({
      name: r.name,
      position: r.cid,
      dataType: r.type,
      nullable: r.notnull === 0,
      defaultExpr: r.dflt_value,
      isPrimaryKey: r.pk > 0,
      comment: null,
    }));
  const primaryKey = primaryKeyFromColumns(columns, rawColumns);

  const indexes = listIndexes(exec, table);
  const nullableByName = new Map(columns.map((c) => [c.name, c.nullable]));
  const uniqueKeys = indexes
    .filter((idx) => idx.unique && idx.columns.every((c) => nullableByName.get(c) === false))
    .map((idx) => idx.columns);

  // Independent of whether a primary key exists — read.ts's own fallback order (PK, else a
  // unique index, else rowid, D22) decides when this is actually consulted; a WITHOUT ROWID
  // table (wr === 1) always has its own declared PK by SQLite's own rule, so this is simply null
  // there. `type` has to be checked too: `pragma_table_list` reports `wr: 0` for a *view* as well
  // (the field is meaningless there, not "false"), so `wr === 0` alone would tell a view it has an
  // implicit rowid and then try to SELECT a column that does not exist on it (found empirically —
  // reading order_summary crashed with "no such column: rowid" before this check existed).
  const [tableInfo] = exec<{ type: string; wr: number }>(
    'SELECT type, wr FROM pragma_table_list(?)',
    [table],
  );
  const isRowidTable = tableInfo?.type !== 'view' && (tableInfo?.wr ?? 1) === 0;
  const rowidColumn = pickRowidColumn(columns, isRowidTable);

  return { qualifiedName: { schema, table }, columns, primaryKey, uniqueKeys, rowidColumn };
}
