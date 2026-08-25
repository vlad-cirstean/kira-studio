import {
  type ColumnMeta,
  encodePath,
  type ForeignKeyMeta,
  type IndexMeta,
  type TreeNode,
} from '../../../shared/domain/tree';

// Every function takes an `exec` rather than a `Connection` directly, so every catalog query is
// routed through query.ts's runQuery — cancellable and command-logged like any other query.
// Every query binds identifiers as parameters and resolves them through information_schema —
// the standing ground rule: never interpolate a database identifier into SQL.
export type QueryExecutor = <T = Record<string, unknown>>(
  sql: string,
  params: unknown[],
) => Promise<T[]>;

const SYSTEM_SCHEMAS = ['information_schema', 'performance_schema', 'mysql', 'sys'];

export async function listDatabases(
  exec: QueryExecutor,
  currentDatabase: string,
): Promise<TreeNode[]> {
  const placeholders = SYSTEM_SCHEMAS.map(() => '?').join(', ');
  const rows = await exec<{ name: string }>(
    `SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME NOT IN (${placeholders})
     ORDER BY SCHEMA_NAME`,
    SYSTEM_SCHEMAS,
  );
  return rows.map((row) => ({
    kind: 'database',
    name: row.name,
    path: encodePath([{ kind: 'database', name: row.name }]),
    hasChildren: true,
    detail: row.name === currentDatabase ? 'connected' : undefined,
  }));
}

const TABLE_TYPE_TO_NODEKIND: Record<string, 'table' | 'view' | 'sequence'> = {
  'BASE TABLE': 'table',
  VIEW: 'view',
  SEQUENCE: 'sequence',
};

interface RelationRow {
  name: string;
  table_type: string;
  table_rows: string | number | null;
  comment: string | null;
}

// §5.1: database -> tables/views/routines -> column. No schema level (D-note in the plan's §6d).
export async function listTablesAndRoutines(
  exec: QueryExecutor,
  database: string,
): Promise<TreeNode[]> {
  const relations = await exec<RelationRow>(
    `SELECT TABLE_NAME AS name, TABLE_TYPE AS table_type, TABLE_ROWS AS table_rows,
            TABLE_COMMENT AS comment
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = ?
     ORDER BY CASE TABLE_TYPE WHEN 'BASE TABLE' THEN 0 WHEN 'VIEW' THEN 1 WHEN 'SEQUENCE' THEN 2
                              ELSE 0 END, TABLE_NAME`,
    [database],
  );

  const relationNodes: TreeNode[] = relations.map((row) => {
    // If the server reports sequences as base tables, they simply appear as tables — no
    // special-casing (§6d).
    const kind = TABLE_TYPE_TO_NODEKIND[row.table_type] ?? 'table';
    const estimate = row.table_rows === null ? null : Number(row.table_rows);
    // TABLE_ROWS is an InnoDB estimate and can be far off — a hint in the tree; Σ count all is
    // the exact answer.
    const detail =
      kind === 'table' && estimate !== null ? `~${estimate.toLocaleString()} rows` : undefined;
    return {
      kind,
      name: row.name,
      path: encodePath([
        { kind: 'database', name: database },
        { kind, name: row.name },
      ]),
      // P19 D5: every relation is a leaf now — a table/view's columns moved into the
      // definition view, and a sequence never had children.
      hasChildren: false,
      detail,
    };
  });

  const routines = await exec<{ name: string; routine_type: string; dtd: string | null }>(
    `SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS routine_type, DTD_IDENTIFIER AS dtd
     FROM information_schema.ROUTINES
     WHERE ROUTINE_SCHEMA = ?
     ORDER BY ROUTINE_NAME`,
    [database],
  );
  const routineNodes: TreeNode[] = routines.map((row) => ({
    kind: 'function',
    name: row.name,
    path: encodePath([
      { kind: 'database', name: database },
      { kind: 'function', name: row.name },
    ]),
    hasChildren: false,
    detail: row.routine_type === 'FUNCTION' ? (row.dtd ?? undefined) : 'procedure',
  }));

  return [...relationNodes, ...routineNodes];
}

interface ColumnRow {
  name: string;
  position: number | bigint;
  data_type: string;
  is_nullable: string;
  default_expr: string | null;
  comment: string | null;
}

// `COLUMN_TYPE`, not `DATA_TYPE` — `varchar(50)` is what the user wants to see (§6d).
export async function listColumns(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ColumnMeta[]> {
  const rows = await exec<ColumnRow>(
    `SELECT COLUMN_NAME AS name, ORDINAL_POSITION AS position, COLUMN_TYPE AS data_type,
            IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS default_expr, COLUMN_COMMENT AS comment
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY ORDINAL_POSITION`,
    [database, table],
  );
  return rows.map((row) => ({
    name: row.name,
    // ORDINAL_POSITION comes back as a BigInt (same information_schema BIGINT quirk as
    // NON_UNIQUE in listIndexes) — ColumnMeta.position is arithmetic'd on downstream (sorted by
    // subtraction in read.ts's resolveProjection), so it must be a real number here.
    position: Number(row.position),
    dataType: row.data_type,
    nullable: row.is_nullable === 'YES',
    defaultExpr: row.default_expr,
    isPrimaryKey: false,
    comment: row.comment ? row.comment : null,
  }));
}

interface IndexRow {
  index_name: string;
  non_unique: number | bigint;
  index_type: string;
  column_name: string;
  seq: number;
}

export async function listIndexes(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<IndexMeta[]> {
  const rows = await exec<IndexRow>(
    `SELECT INDEX_NAME AS index_name, NON_UNIQUE AS non_unique, INDEX_TYPE AS index_type,
            COLUMN_NAME AS column_name, SEQ_IN_INDEX AS seq
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    [database, table],
  );
  const byName = new Map<string, IndexRow[]>();
  for (const row of rows) {
    const group = byName.get(row.index_name);
    if (group) group.push(row);
    else byName.set(row.index_name, [row]);
  }
  return [...byName.entries()].map(([name, group]) => ({
    name,
    columns: group.map((r) => r.column_name),
    // NON_UNIQUE comes back from the driver as a BigInt (information_schema.STATISTICS defines
    // it as bigint) — Number(...) === 0 avoids the 0n !== 0 trap of a direct strict comparison.
    unique: Number(group[0].non_unique) === 0,
    primary: name === 'PRIMARY',
    method: group[0].index_type,
  }));
}

export function primaryKeyFromIndexes(indexes: IndexMeta[]): string[] | null {
  return indexes.find((idx) => idx.primary)?.columns ?? null;
}

interface ForeignKeyRow {
  name: string;
  column_name: string;
  ord: number;
  ref_schema: string;
  ref_table: string;
  ref_column: string;
  on_delete: string;
  on_update: string;
}

async function queryOutboundForeignKeys(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ForeignKeyRow[]> {
  return exec<ForeignKeyRow>(
    `SELECT kcu.CONSTRAINT_NAME AS name, kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ord,
            kcu.REFERENCED_TABLE_SCHEMA AS ref_schema, kcu.REFERENCED_TABLE_NAME AS ref_table,
            kcu.REFERENCED_COLUMN_NAME AS ref_column,
            rc.DELETE_RULE AS on_delete, rc.UPDATE_RULE AS on_update
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
     ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [database, table],
  );
}

interface ReferencedByRow {
  name: string;
  src_schema: string;
  src_table: string;
  src_column: string;
  ref_column: string;
  ord: number;
  on_delete: string;
  on_update: string;
}

async function queryInboundForeignKeys(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ReferencedByRow[]> {
  return exec<ReferencedByRow>(
    `SELECT kcu.CONSTRAINT_NAME AS name, kcu.TABLE_SCHEMA AS src_schema, kcu.TABLE_NAME AS src_table,
            kcu.COLUMN_NAME AS src_column, kcu.REFERENCED_COLUMN_NAME AS ref_column,
            kcu.ORDINAL_POSITION AS ord,
            rc.DELETE_RULE AS on_delete, rc.UPDATE_RULE AS on_update
     FROM information_schema.KEY_COLUMN_USAGE kcu
     JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.REFERENCED_TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME = ?
     ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    [database, table],
  );
}

// Outbound (this table's own FKs): `columns` are mine; referencedPath/referencedColumns describe
// the other table. `referencedPath` is a two-segment path (database/table) — one shallower than
// Postgres's three, the assertion that the tree code is genuinely path-driven (§6d).
export async function listForeignKeys(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ForeignKeyMeta[]> {
  const rows = await queryOutboundForeignKeys(exec, database, table);
  const byName = new Map<string, ForeignKeyRow[]>();
  for (const row of rows) {
    const group = byName.get(row.name);
    if (group) group.push(row);
    else byName.set(row.name, [row]);
  }
  return [...byName.entries()].map(([name, group]) => ({
    name,
    columns: group.map((r) => r.column_name),
    referencedPath: encodePath([
      { kind: 'database', name: group[0].ref_schema },
      { kind: 'table', name: group[0].ref_table },
    ]),
    referencedColumns: group.map((r) => r.ref_column),
    onDelete: group[0].on_delete,
    onUpdate: group[0].on_update,
  }));
}

// Inbound (D17 of P1): I am the referenced table, so my own columns are `ref_column` and the
// other (referencing) table is `src_*` — the mirror image of listForeignKeys, keeping `columns`
// = mine, referencedPath/referencedColumns = the other table, for both directions.
export async function listReferencedBy(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ForeignKeyMeta[]> {
  const rows = await queryInboundForeignKeys(exec, database, table);
  const byName = new Map<string, ReferencedByRow[]>();
  for (const row of rows) {
    const group = byName.get(row.name);
    if (group) group.push(row);
    else byName.set(row.name, [row]);
  }
  return [...byName.entries()].map(([name, group]) => ({
    name,
    columns: group.map((r) => r.ref_column),
    referencedPath: encodePath([
      { kind: 'database', name: group[0].src_schema },
      { kind: 'table', name: group[0].src_table },
    ]),
    referencedColumns: group.map((r) => r.src_column),
    onDelete: group[0].on_delete,
    onUpdate: group[0].on_update,
  }));
}

export interface ReadTarget {
  qualifiedName: { database: string; table: string };
  columns: ColumnMeta[];
  primaryKey: string[] | null;
  /** Unique indexes whose columns are all NOT NULL — keyset tiebreaker candidates (D7). */
  uniqueKeys: string[][];
}

// The read path needs the relation's columns/PK/unique-index shape in one shot (D10: resolved
// fresh on every uncached read, in the same op, right before the data statement).
export async function getReadTarget(
  exec: QueryExecutor,
  database: string,
  table: string,
): Promise<ReadTarget> {
  const rawColumns = await listColumns(exec, database, table);
  const indexes = await listIndexes(exec, database, table);
  const primaryKey = primaryKeyFromIndexes(indexes);
  const pkColumns = new Set(primaryKey ?? []);
  const columns = rawColumns.map((col) => ({ ...col, isPrimaryKey: pkColumns.has(col.name) }));
  const nullableByName = new Map(columns.map((c) => [c.name, c.nullable]));
  const uniqueKeys = indexes
    .filter((idx) => idx.unique && idx.columns.every((c) => nullableByName.get(c) === false))
    .map((idx) => idx.columns);
  return { qualifiedName: { database, table }, columns, primaryKey, uniqueKeys };
}
