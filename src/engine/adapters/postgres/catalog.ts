import type { Client } from 'pg';
import type { OpCtx } from '../adapter';
import { type RunningQuery, runQuery } from './query';

// The catalog SQL, one function per level. Ground rule (P1 §0): identifiers are looked up by name
// as bind parameters against pg_namespace/pg_class — there is no quote_ident string-building here.

type Track = (q: RunningQuery) => void;

export interface DatabaseRow {
  name: string;
  comment: string | null;
}

export interface SchemaRow {
  name: string;
}

export interface RelationRow {
  name: string;
  relkind: string;
  rowEstimate: number | null;
  comment: string | null;
}

export interface FunctionRow {
  name: string;
  args: string;
}

export interface ColumnRow {
  name: string;
  position: number;
  dataType: string;
  nullable: boolean;
  defaultExpr: string | null;
  comment: string | null;
}

export interface RelationInfoRow {
  oid: number | string;
  relkind: string;
  rowEstimate: number | null;
  comment: string | null;
}

export interface IndexRow {
  name: string;
  unique: boolean;
  primary: boolean;
  method: string | null;
  columns: string[];
}

export interface ForeignKeyRow {
  name: string;
  onDelete: string | null;
  onUpdate: string | null;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  srcSchema: string;
  srcTable: string;
}

const DATABASES_SQL = `
  SELECT datname AS name,
         pg_catalog.shobj_description(oid, 'pg_database') AS comment
  FROM pg_database
  WHERE NOT datistemplate AND datallowconn
  ORDER BY datname`;

const SCHEMAS_SQL = `
  SELECT nspname AS name
  FROM pg_namespace
  WHERE nspname NOT IN ('pg_catalog', 'information_schema')
    AND nspname NOT LIKE 'pg\\_toast%' AND nspname NOT LIKE 'pg\\_temp%'
  ORDER BY nspname`;

const RELATIONS_SQL = `
  SELECT c.relname AS name, c.relkind,
         c.reltuples::bigint AS row_estimate,
         obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind = ANY('{r,p,v,m,S}')
  ORDER BY CASE c.relkind WHEN 'r' THEN 0 WHEN 'p' THEN 0 WHEN 'v' THEN 1
                          WHEN 'm' THEN 2 WHEN 'S' THEN 3 END, c.relname`;

const FUNCTIONS_SQL = `
  SELECT p.proname AS name,
         pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = $1 AND p.prokind IN ('f', 'p')
  ORDER BY p.proname`;

const COLUMNS_SQL = `
  SELECT a.attname AS name, a.attnum AS position,
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
  ORDER BY a.attnum`;

const RELATION_INFO_SQL = `
  SELECT c.oid, c.relkind, c.reltuples::bigint AS row_estimate,
         obj_description(c.oid, 'pg_class') AS comment
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relname = $2`;

const INDEXES_SQL = `
  SELECT i.relname AS name, ix.indisunique AS unique, ix.indisprimary AS primary,
         am.amname AS method,
         to_jsonb(ARRAY(SELECT a.attname
                        FROM generate_subscripts(ix.indkey, 1) AS k(i)
                        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = ix.indkey[k.i]
                        WHERE ix.indkey[k.i] > 0
                        ORDER BY k.i)) AS columns
  FROM pg_index ix
  JOIN pg_class i ON i.oid = ix.indexrelid
  JOIN pg_am am ON am.oid = i.relam
  WHERE ix.indrelid = $1::oid`;

// Outbound FKs have con.conrelid = the local table; inbound (referencedBy) have con.confrelid.
// The name lists are wrapped in to_jsonb so node-postgres parses them into JS arrays (a bare
// text[] is delivered as a "{a,b}" string, which would silently become an empty list on read-back).
const FOREIGN_KEYS_SQL = (inbound: boolean) => `
  SELECT con.conname AS name,
         con.confdeltype AS on_delete, con.confupdtype AS on_update,
         to_jsonb((SELECT array_agg(att.attname ORDER BY u.ord)
                   FROM unnest(con.conkey) WITH ORDINALITY u(attnum, ord)
                   JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum)) AS columns,
         fn.nspname AS ref_schema, fc.relname AS ref_table,
         to_jsonb((SELECT array_agg(att.attname ORDER BY u.ord)
                   FROM unnest(con.confkey) WITH ORDINALITY u(attnum, ord)
                   JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = u.attnum)) AS ref_columns,
         sn.nspname AS src_schema, sc.relname AS src_table
  FROM pg_constraint con
  JOIN pg_class fc ON fc.oid = con.confrelid JOIN pg_namespace fn ON fn.oid = fc.relnamespace
  JOIN pg_class sc ON sc.oid = con.conrelid  JOIN pg_namespace sn ON sn.oid = sc.relnamespace
  WHERE con.contype = 'f' AND ${inbound ? 'con.confrelid' : 'con.conrelid'} = $1::oid`;

export async function listDatabases(
  client: Client,
  ctx: OpCtx,
  track: Track,
): Promise<DatabaseRow[]> {
  const rows = await runQuery<Record<string, unknown>>(client, DATABASES_SQL, [], ctx, track);
  return rows.map((r) => ({
    name: String(r.name),
    comment: (r.comment as string | null) ?? null,
  }));
}

export async function listSchemas(client: Client, ctx: OpCtx, track: Track): Promise<SchemaRow[]> {
  const rows = await runQuery<Record<string, unknown>>(client, SCHEMAS_SQL, [], ctx, track);
  return rows.map((r) => ({ name: String(r.name) }));
}

export async function listRelations(
  client: Client,
  schema: string,
  ctx: OpCtx,
  track: Track,
): Promise<RelationRow[]> {
  const rows = await runQuery<Record<string, unknown>>(client, RELATIONS_SQL, [schema], ctx, track);
  return rows.map((r) => {
    const estimate = r.row_estimate == null ? null : Number(r.row_estimate);
    return {
      name: String(r.name),
      relkind: String(r.relkind),
      rowEstimate: estimate !== null && estimate >= 0 ? estimate : null,
      comment: (r.comment as string | null) ?? null,
    };
  });
}

export async function listFunctions(
  client: Client,
  schema: string,
  ctx: OpCtx,
  track: Track,
): Promise<FunctionRow[]> {
  const rows = await runQuery<Record<string, unknown>>(client, FUNCTIONS_SQL, [schema], ctx, track);
  return rows.map((r) => ({ name: String(r.name), args: String(r.args ?? '') }));
}

export async function listColumns(
  client: Client,
  schema: string,
  relation: string,
  ctx: OpCtx,
  track: Track,
): Promise<ColumnRow[]> {
  const rows = await runQuery<Record<string, unknown>>(
    client,
    COLUMNS_SQL,
    [schema, relation],
    ctx,
    track,
  );
  return rows.map((r) => ({
    name: String(r.name),
    position: Number(r.position),
    dataType: String(r.data_type),
    nullable: r.nullable === true,
    defaultExpr: (r.default_expr as string | null) ?? null,
    comment: (r.comment as string | null) ?? null,
  }));
}

export async function getRelationInfo(
  client: Client,
  schema: string,
  relation: string,
  ctx: OpCtx,
  track: Track,
): Promise<RelationInfoRow | null> {
  const rows = await runQuery<Record<string, unknown>>(
    client,
    RELATION_INFO_SQL,
    [schema, relation],
    ctx,
    track,
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const estimate = r.row_estimate == null ? null : Number(r.row_estimate);
  return {
    oid: r.oid as number | string,
    relkind: String(r.relkind),
    rowEstimate: estimate !== null && estimate >= 0 ? estimate : null,
    comment: (r.comment as string | null) ?? null,
  };
}

export async function listIndexes(
  client: Client,
  relationOid: number | string,
  ctx: OpCtx,
  track: Track,
): Promise<IndexRow[]> {
  const rows = await runQuery<Record<string, unknown>>(
    client,
    INDEXES_SQL,
    [relationOid],
    ctx,
    track,
  );
  return rows.map((r) => ({
    name: String(r.name),
    unique: r.unique === true,
    primary: r.primary === true,
    method: (r.method as string | null) ?? null,
    columns: Array.isArray(r.columns) ? (r.columns as unknown[]).map(String) : [],
  }));
}

export async function listForeignKeys(
  client: Client,
  relationOid: number | string,
  inbound: boolean,
  ctx: OpCtx,
  track: Track,
): Promise<ForeignKeyRow[]> {
  const rows = await runQuery<Record<string, unknown>>(
    client,
    FOREIGN_KEYS_SQL(inbound),
    [relationOid],
    ctx,
    track,
  );
  return rows.map((r) => ({
    name: String(r.name),
    onDelete: (r.on_delete as string | null) ?? null,
    onUpdate: (r.on_update as string | null) ?? null,
    columns: Array.isArray(r.columns) ? (r.columns as unknown[]).map(String) : [],
    refSchema: String(r.ref_schema),
    refTable: String(r.ref_table),
    refColumns: Array.isArray(r.ref_columns) ? (r.ref_columns as unknown[]).map(String) : [],
    srcSchema: String(r.src_schema),
    srcTable: String(r.src_table),
  }));
}
