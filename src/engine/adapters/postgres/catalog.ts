import type { QueryResultRow } from 'pg';
import {
  type ColumnMeta,
  encodePath,
  type ForeignKeyMeta,
  type IndexMeta,
  type NodeKind,
  type TreeNode,
} from '../../../shared/domain/tree';
import { AdapterError } from '../../adapters/errors';

// Every function below takes an `exec` rather than a `pg.Client` directly, so every catalog
// query is routed through query.ts's runQuery — cancellable and command-logged like any other
// query (the risk register is explicit: catalog lookups on a large database must be cancellable
// even in P1, not just data reads). Every query binds identifiers as parameters and resolves
// them through the catalog — the standing ground rule: never interpolate a database identifier
// into SQL.
export type QueryExecutor = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[],
) => Promise<T[]>;

export async function listDatabases(
  exec: QueryExecutor,
  currentDatabase: string,
): Promise<TreeNode[]> {
  const rows = await exec<{ name: string; comment: string | null }>(
    `SELECT datname AS name,
            pg_catalog.shobj_description(oid, 'pg_database') AS comment
     FROM pg_database
     WHERE NOT datistemplate AND datallowconn
     ORDER BY datname`,
    [],
  );
  return rows.map((row) => ({
    kind: 'database',
    name: row.name,
    path: encodePath([{ kind: 'database', name: row.name }]),
    hasChildren: true,
    detail: row.name === currentDatabase ? 'connected' : undefined,
  }));
}

// D15: system schemas are hidden.
export async function listSchemas(
  exec: QueryExecutor,
  databaseSegment: string,
): Promise<TreeNode[]> {
  const rows = await exec<{ name: string }>(
    `SELECT nspname AS name
     FROM pg_namespace
     WHERE nspname NOT IN ('pg_catalog', 'information_schema')
       AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'
     ORDER BY nspname`,
    [],
  );
  return rows.map((row) => ({
    kind: 'schema',
    name: row.name,
    path: encodePath([
      { kind: 'database', name: databaseSegment },
      { kind: 'schema', name: row.name },
    ]),
    hasChildren: true,
  }));
}

const RELKIND_TO_NODEKIND: Record<string, NodeKind> = {
  r: 'table',
  p: 'table',
  v: 'view',
  m: 'matview',
  S: 'sequence',
};

interface RelationRow {
  name: string;
  relkind: string;
  row_estimate: string | null;
  comment: string | null;
}

// D15: a schema's children are the objects themselves, no Tables/Views folder nodes. Functions
// share the level (appended after relations, per §5d).
export async function listRelationsAndFunctions(
  exec: QueryExecutor,
  databaseSegment: string,
  schema: string,
): Promise<TreeNode[]> {
  const relations = await exec<RelationRow>(
    `SELECT c.relname AS name, c.relkind,
            c.reltuples::bigint AS row_estimate,
            obj_description(c.oid, 'pg_class') AS comment
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relkind = ANY('{r,p,v,m,S}')
     ORDER BY CASE c.relkind WHEN 'r' THEN 0 WHEN 'p' THEN 0 WHEN 'v' THEN 1
                             WHEN 'm' THEN 2 WHEN 'S' THEN 3 END, c.relname`,
    [schema],
  );

  const relationNodes: TreeNode[] = relations.map((row) => {
    const kind = RELKIND_TO_NODEKIND[row.relkind] ?? 'table';
    const estimate = row.row_estimate === null ? null : Number(row.row_estimate);
    // Postgres uses -1 for "never analysed" — render nothing, never the raw -1.
    const detail =
      (kind === 'table' || kind === 'matview') && estimate !== null && estimate >= 0
        ? `~${estimate.toLocaleString()} rows`
        : undefined;
    return {
      kind,
      name: row.name,
      path: encodePath([
        { kind: 'database', name: databaseSegment },
        { kind: 'schema', name: schema },
        { kind, name: row.name },
      ]),
      // P19 D5: every relation is a leaf now — a table/view/matview's columns moved into the
      // definition view, and a sequence never had children.
      hasChildren: false,
      detail,
    };
  });

  const functions = await exec<{ name: string; args: string }>(
    `SELECT p.proname AS name,
            pg_get_function_identity_arguments(p.oid) AS args
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
     ORDER BY p.proname`,
    [schema],
  );

  const functionNodes: TreeNode[] = functions.map((row) => ({
    kind: 'function',
    name: row.name,
    path: encodePath([
      { kind: 'database', name: databaseSegment },
      { kind: 'schema', name: schema },
      { kind: 'function', name: row.name },
    ]),
    hasChildren: false,
    detail: `(${row.args})`,
  }));

  return [...relationNodes, ...functionNodes];
}

export interface RelationInfo {
  oid: string;
  comment: string | null;
  rowEstimate: number | null;
}

// describe()'s own OID lookup — also pulls the comment and row estimate so ObjectMeta doesn't
// need a second round trip for what listRelationsAndFunctions already knows how to compute at
// the schema level.
export async function getRelationInfo(
  exec: QueryExecutor,
  schema: string,
  table: string,
): Promise<RelationInfo> {
  const rows = await exec<{ oid: string; comment: string | null; row_estimate: string | null }>(
    `SELECT c.oid::text AS oid, obj_description(c.oid, 'pg_class') AS comment,
            c.reltuples::bigint AS row_estimate
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, table],
  );
  const row = rows[0];
  if (!row) throw new AdapterError('E_NOT_FOUND', `relation "${schema}"."${table}" not found`);
  const estimate = row.row_estimate === null ? null : Number(row.row_estimate);
  return {
    oid: row.oid,
    comment: row.comment,
    // Postgres uses -1 for "never analysed" — surface null, never the raw -1 (same rule as
    // the tree's ~N rows detail).
    rowEstimate: estimate !== null && estimate >= 0 ? estimate : null,
  };
}

interface ColumnRow {
  name: string;
  position: number;
  data_type: string;
  nullable: boolean;
  default_expr: string | null;
  comment: string | null;
}

// Raw columns, with `isPrimaryKey` left false — callers fold in the primary-key column list
// from listIndexes (the PK is discovered by asking for indexes, per §5d) before exposing this
// as ColumnMeta.
export async function listColumns(
  exec: QueryExecutor,
  schema: string,
  table: string,
): Promise<ColumnMeta[]> {
  const rows = await exec<ColumnRow>(
    `SELECT a.attname AS name, a.attnum AS position,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr,
            col_description(a.attrelid, a.attnum) AS comment
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = (
             SELECT c.oid FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2)
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [schema, table],
  );
  return rows.map((row) => ({
    name: row.name,
    position: row.position,
    dataType: row.data_type,
    nullable: row.nullable,
    defaultExpr: row.default_expr,
    isPrimaryKey: false,
    comment: row.comment,
  }));
}

interface IndexRow {
  name: string;
  unique: boolean;
  primary: boolean;
  method: string | null;
  columns: string[];
}

export async function listIndexes(exec: QueryExecutor, relOid: string): Promise<IndexMeta[]> {
  const rows = await exec<IndexRow>(
    `SELECT i.relname AS name, ix.indisunique AS unique, ix.indisprimary AS primary,
            am.amname AS method,
            ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k.i + 1, true)
                  FROM generate_subscripts(ix.indkey, 1) AS k(i) ORDER BY k.i) AS columns
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_am am ON am.oid = i.relam
     WHERE ix.indrelid = $1::oid`,
    [relOid],
  );
  return rows.map((row) => ({
    name: row.name,
    columns: row.columns,
    unique: row.unique,
    primary: row.primary,
    method: row.method,
  }));
}

export function primaryKeyFromIndexes(indexes: IndexMeta[]): string[] | null {
  return indexes.find((idx) => idx.primary)?.columns ?? null;
}

export interface ReadTarget {
  oid: string;
  qualifiedName: { schema: string; relation: string };
  columns: ColumnMeta[];
  primaryKey: string[] | null;
  /** Unique indexes whose columns are all NOT NULL — keyset tiebreaker candidates (D7). */
  uniqueKeys: string[][];
}

// The read path needs the relation's columns/PK/unique-index shape in one shot (D10: resolved
// fresh on every uncached read, in the same op, right before the data statement).
export async function getReadTarget(
  exec: QueryExecutor,
  schema: string,
  relation: string,
): Promise<ReadTarget> {
  const info = await getRelationInfo(exec, schema, relation);
  // Sequential, not Promise.all — see index.ts's comment: node-postgres has deprecated firing
  // concurrent queries at one Client.
  const rawColumns = await listColumns(exec, schema, relation);
  const indexes = await listIndexes(exec, info.oid);
  const primaryKey = primaryKeyFromIndexes(indexes);
  const pkColumns = new Set(primaryKey ?? []);
  const columns = rawColumns.map((col) => ({ ...col, isPrimaryKey: pkColumns.has(col.name) }));
  const nullableByName = new Map(columns.map((c) => [c.name, c.nullable]));
  const uniqueKeys = indexes
    .filter((idx) => idx.unique && idx.columns.every((c) => nullableByName.get(c) === false))
    .map((idx) => idx.columns);
  return { oid: info.oid, qualifiedName: { schema, relation }, columns, primaryKey, uniqueKeys };
}

const CONSTRAINT_ACTION: Record<string, string> = {
  a: 'NO ACTION',
  r: 'RESTRICT',
  c: 'CASCADE',
  n: 'SET NULL',
  d: 'SET DEFAULT',
};

interface ForeignKeyRow {
  name: string;
  on_delete: string;
  on_update: string;
  columns: string[] | null;
  ref_schema: string;
  ref_table: string;
  ref_columns: string[] | null;
  src_schema: string;
  src_table: string;
}

async function queryForeignKeyEdges(
  exec: QueryExecutor,
  relOid: string,
  direction: 'outbound' | 'inbound',
): Promise<ForeignKeyRow[]> {
  const whereClause =
    direction === 'outbound' ? 'con.conrelid = $1::oid' : 'con.confrelid = $1::oid';
  return exec<ForeignKeyRow>(
    `SELECT con.conname AS name,
            con.confdeltype AS on_delete, con.confupdtype AS on_update,
            (SELECT array_agg(att.attname::text ORDER BY u.ord)
               FROM unnest(con.conkey) WITH ORDINALITY u(attnum, ord)
               JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum) AS columns,
            fn.nspname AS ref_schema, fc.relname AS ref_table,
            (SELECT array_agg(att.attname::text ORDER BY u.ord)
               FROM unnest(con.confkey) WITH ORDINALITY u(attnum, ord)
               JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = u.attnum) AS ref_columns,
            sn.nspname AS src_schema, sc.relname AS src_table
     FROM pg_constraint con
     JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
     JOIN pg_class sc ON sc.oid = con.conrelid  JOIN pg_namespace sn ON sn.oid = sc.relnamespace
     WHERE con.contype = 'f' AND ${whereClause}`,
    [relOid],
  );
}

// Outbound (this table's own FKs): `columns` are mine (conkey, since conrelid = me);
// referencedPath/referencedColumns describe the other (confrelid) table.
export async function listForeignKeys(
  exec: QueryExecutor,
  relOid: string,
  databaseSegment: string,
): Promise<ForeignKeyMeta[]> {
  const rows = await queryForeignKeyEdges(exec, relOid, 'outbound');
  return rows.map((row) => ({
    name: row.name,
    columns: row.columns ?? [],
    referencedPath: encodePath([
      { kind: 'database', name: databaseSegment },
      { kind: 'schema', name: row.ref_schema },
      { kind: 'table', name: row.ref_table },
    ]),
    referencedColumns: row.ref_columns ?? [],
    onDelete: CONSTRAINT_ACTION[row.on_delete] ?? null,
    onUpdate: CONSTRAINT_ACTION[row.on_update] ?? null,
  }));
}

// Inbound (D17): I am confrelid here, so my own columns are confkey (ref_columns) and the
// other (referencing) table is conrelid (src_*) with its columns in conkey (columns) — the
// mirror image of listForeignKeys, keeping `columns` = mine, referencedPath/referencedColumns
// = the other table, for both directions.
export async function listReferencedBy(
  exec: QueryExecutor,
  relOid: string,
  databaseSegment: string,
): Promise<ForeignKeyMeta[]> {
  const rows = await queryForeignKeyEdges(exec, relOid, 'inbound');
  return rows.map((row) => ({
    name: row.name,
    columns: row.ref_columns ?? [],
    referencedPath: encodePath([
      { kind: 'database', name: databaseSegment },
      { kind: 'schema', name: row.src_schema },
      { kind: 'table', name: row.src_table },
    ]),
    referencedColumns: row.columns ?? [],
    onDelete: CONSTRAINT_ACTION[row.on_delete] ?? null,
    onUpdate: CONSTRAINT_ACTION[row.on_update] ?? null,
  }));
}
