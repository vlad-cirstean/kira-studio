import {
  type ColumnMeta,
  encodePath,
  type IndexMeta,
  type TreeNode,
} from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import { unwrapType } from './read';

// Every function takes an `exec` rather than a handle directly, mirroring every other SQL
// adapter's own catalog.ts discipline — command-logged and cancellation-checked the same way any
// other query is (query.ts's runCatalogQuery). D19: every value bound here travels as a real
// ClickHouse query parameter (`{db:String}`, `{tbl:String}`), never interpolated — verified
// empirically to be sent as URL parameters (`param_db=...`), with the client's own escaping.
export type QueryExecutor = <T = Record<string, unknown>>(
  sql: string,
  params?: Record<string, string>,
) => Promise<T[]>;

interface DatabaseRow {
  name: string;
}

// D15: hides both spellings of the information_schema emulation (system.* is the honest,
// ClickHouse-native catalog this adapter itself reads from — F13); keeps `system` unlike
// mysql-family's own SYSTEM_SCHEMAS exclusion, since it is genuinely browsable (query_log,
// parts, mutations) and hiding it would be hiding the thing the app is built on (D15, raised as
// open question 2).
export async function listDatabases(exec: QueryExecutor): Promise<TreeNode[]> {
  const rows = await exec<DatabaseRow>(
    `SELECT name FROM system.databases
     WHERE name NOT IN ('INFORMATION_SCHEMA', 'information_schema')
     ORDER BY name`,
  );
  return rows.map((row) => ({
    kind: 'database' as const,
    name: row.name,
    path: encodePath([{ kind: 'database', name: row.name }]),
    hasChildren: true,
  }));
}

interface SystemTableRow {
  database: string;
  name: string;
  engine: string;
  comment: string;
  total_rows: string | null;
  sorting_key: string;
  primary_key: string;
  partition_key: string;
  create_table_query: string;
}

const TABLE_COLUMNS =
  'database, name, engine, comment, total_rows, sorting_key, primary_key, partition_key, create_table_query';

async function relevantTables(exec: QueryExecutor, schema: string): Promise<SystemTableRow[]> {
  return exec<SystemTableRow>(
    `SELECT ${TABLE_COLUMNS} FROM system.tables
     WHERE database = {db:String} AND is_temporary = 0
     ORDER BY name`,
    { db: schema },
  );
}

// F33: engine name is the object's kind — 'View' and 'MaterializedView' are ClickHouse's own
// spellings, everything else (MergeTree family, Dictionary, Log, Memory, ...) reads through
// SELECT like any other table.
function kindForEngine(engine: string): 'table' | 'view' | 'matview' {
  if (engine === 'View') return 'view';
  if (engine === 'MaterializedView') return 'matview';
  return 'table';
}

// §5.1: database -> tables/views/materialized views (ungrouped here; the renderer's own
// GROUPED_KINDS folders view/matview, F45) -> column. No sequence or routine level — ClickHouse
// has neither.
export async function listTablesAndViews(exec: QueryExecutor, schema: string): Promise<TreeNode[]> {
  const tables = await relevantTables(exec, schema);
  return tables
    .sort((a, b) => {
      const rank = (t: SystemTableRow) => (kindForEngine(t.engine) === 'table' ? 0 : 1);
      const r = rank(a) - rank(b);
      return r !== 0 ? r : a.name.localeCompare(b.name);
    })
    .map((row) => {
      const kind = kindForEngine(row.engine);
      const estimate = kind === 'table' && row.total_rows !== null ? Number(row.total_rows) : null;
      return {
        kind,
        name: row.name,
        path: encodePath([
          { kind: 'database', name: schema },
          { kind, name: row.name },
        ]),
        // P19 D5: every relation is a leaf — a table/view's columns live in describe()/definition().
        hasChildren: false,
        detail: estimate !== null ? `~${estimate.toLocaleString()} rows` : undefined,
      };
    });
}

interface SystemColumnRow {
  name: string;
  type: string;
  position: number;
  default_kind: string;
  default_expression: string;
  comment: string;
}

async function listColumnsRaw(
  exec: QueryExecutor,
  schema: string,
  table: string,
): Promise<SystemColumnRow[]> {
  return exec<SystemColumnRow>(
    `SELECT name, type, position, default_kind, default_expression, comment
     FROM system.columns
     WHERE database = {db:String} AND table = {tbl:String}
     ORDER BY position`,
    { db: schema, tbl: table },
  );
}

// F15/D28: nullability lives inside the type string (Nullable(T), possibly wrapped again in
// LowCardinality), not a separate column — read.ts's own unwrapType is the one parser for it,
// reused here rather than duplicated.
//
// D18/D23: isPrimaryKey is always false here, deliberately not read from
// system.columns.is_in_primary_key — that flag tracks the sparse index's own membership, and a
// "PK" badge means something specific everywhere else in this app: a unique, addressable row
// identity. Showing it on a ClickHouse column would claim exactly the uniqueness F16 says does not
// exist, undoing the same honesty ObjectMeta.primaryKey: null already commits to. The sorting/
// primary key expression is still shown in full, verbatim, in the definition view's Table
// properties section (D22) — the truthful place for it.
function toColumnMeta(row: SystemColumnRow): ColumnMeta {
  const { nullable } = unwrapType(row.type);
  return {
    name: row.name,
    position: row.position,
    dataType: row.type,
    nullable,
    defaultExpr: row.default_expression || null,
    isPrimaryKey: false,
    comment: row.comment || null,
  };
}

// Parenthesis-aware split for a key expression such as "toYYYYMM(d), id" — a plain comma split
// would break on the function call's own comma-free single arg here, but not in general
// (e.g. a hypothetical two-arg expression), so depth tracking is the honest version.
function splitTopLevelCommas(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of expr) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') parts.push(current.trim());
  return parts;
}

interface SkippingIndexRow {
  name: string;
  expr: string;
  type: string;
}

// D18: system.data_skipping_indices plus one synthetic entry for the sparse primary index —
// without it the definition view would show nothing at all about the one thing that most
// determines how a MergeTree table behaves. `unique: false` throughout: a skipping index is a
// pruning aid, and the primary index is a sparse index, neither is a uniqueness constraint (F16).
export async function listIndexes(
  exec: QueryExecutor,
  schema: string,
  table: string,
  primaryKeyExpression: string,
): Promise<IndexMeta[]> {
  const skipping = await exec<SkippingIndexRow>(
    `SELECT name, expr, type FROM system.data_skipping_indices
     WHERE database = {db:String} AND table = {tbl:String}`,
    { db: schema, tbl: table },
  );
  const indexes: IndexMeta[] = skipping.map((idx) => ({
    name: idx.name,
    columns: [idx.expr],
    unique: false,
    primary: false,
    method: idx.type,
  }));
  if (primaryKeyExpression.trim() !== '') {
    indexes.unshift({
      name: `${table}_primary_idx`,
      columns: splitTopLevelCommas(primaryKeyExpression),
      unique: false,
      primary: true,
      method: 'sparse (primary index)',
    });
  }
  return indexes;
}

interface ConstraintRow {
  name: string;
  type: string;
  expression: string;
}

// F18 (revised): system.constraints is documented, but does not exist on the server this adapter
// is built/tested against (checked against clickhouse/clickhouse-server:26.3, version()
// 26.3.21.7 — SHOW TABLES FROM system has no such row, and querying it directly fails with
// UNKNOWN_TABLE even for the admin user against a table that does have a CONSTRAINT). CHECK
// constraints are only ever visible through the CREATE TABLE DDL text itself (SHOW CREATE TABLE /
// system.tables.create_table_query), so this parses them out of that text instead of querying a
// catalog table — no network round trip, and no grant can hide it either. 'ASSUME' is a
// query-optimizer hint, not a constraint a user would recognise as one, so only CONSTRAINT ...
// CHECK ... clauses are matched.
const CHECK_CONSTRAINT_RE = /^CONSTRAINT\s+(`(?:[^`]|``)+`|\S+)\s+CHECK\s+([\s\S]+)$/i;

export function listCheckConstraints(createTableQuery: string): ConstraintRow[] {
  const start = createTableQuery.indexOf('(');
  if (start === -1) return [];
  let depth = 0;
  let end = -1;
  for (let i = start; i < createTableQuery.length; i++) {
    if (createTableQuery[i] === '(') depth++;
    else if (createTableQuery[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return [];

  const constraints: ConstraintRow[] = [];
  for (const part of splitTopLevelCommas(createTableQuery.slice(start + 1, end))) {
    const match = CHECK_CONSTRAINT_RE.exec(part.trim());
    if (!match) continue;
    const rawName = match[1];
    const name =
      rawName.startsWith('`') && rawName.endsWith('`')
        ? rawName.slice(1, -1).replace(/``/g, '`')
        : rawName;
    constraints.push({ name, type: 'CHECK', expression: match[2].trim() });
  }
  return constraints;
}

export interface ReadTarget {
  qualifiedName: { schema: string; table: string };
  columns: ColumnMeta[];
  /** F15: MATERIALIZED/ALIAS columns are readable (this adapter never emits SELECT *) but refuse
   *  an INSERT. Plumbed here now; surfaced as ColumnDescriptor.generated once the shared protocol
   *  gains the field (D28, the next commit). */
  generatedColumns: ReadonlySet<string>;
  engine: string;
  /** F14/F31: ClickHouse's own sorting-key expression text, used verbatim as the default
   *  ORDER BY when the request asks for no sort (D21). '' for an engine with no sorting key. */
  sortingKey: string;
  primaryKeyExpression: string;
  partitionKey: string;
  /** F32: exact when ClickHouse can answer cheaply from part metadata, else null — never 0. */
  totalRows: number | null;
  comment: string | null;
  /** D22: the server's own CREATE statement, verbatim — definition.ts's one statement. */
  createTableQuery: string;
}

async function getTableRow(
  exec: QueryExecutor,
  schema: string,
  table: string,
): Promise<SystemTableRow | undefined> {
  const rows = await exec<SystemTableRow>(
    `SELECT ${TABLE_COLUMNS} FROM system.tables
     WHERE database = {db:String} AND name = {tbl:String}`,
    { db: schema, tbl: table },
  );
  return rows[0];
}

// The read/mutate path's one-shot answer for a relation's columns/engine/keys, resolved fresh on
// every op (same discipline as every other SQL adapter's getReadTarget).
export async function getReadTarget(
  exec: QueryExecutor,
  schema: string,
  table: string,
): Promise<ReadTarget> {
  const tableRow = await getTableRow(exec, schema, table);
  if (!tableRow) throw new AdapterError('E_NOT_FOUND', `no such table: "${schema}"."${table}"`);
  const columnRows = await listColumnsRaw(exec, schema, table);
  const columns = columnRows.map(toColumnMeta);
  const generatedColumns = new Set(
    columnRows
      .filter((r) => r.default_kind === 'MATERIALIZED' || r.default_kind === 'ALIAS')
      .map((r) => r.name),
  );
  return {
    qualifiedName: { schema, table },
    columns,
    generatedColumns,
    engine: tableRow.engine,
    sortingKey: tableRow.sorting_key,
    primaryKeyExpression: tableRow.primary_key,
    partitionKey: tableRow.partition_key,
    totalRows: tableRow.total_rows !== null ? Number(tableRow.total_rows) : null,
    comment: tableRow.comment || null,
    createTableQuery: tableRow.create_table_query,
  };
}
