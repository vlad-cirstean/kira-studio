import type { Client } from 'pg';
import { splitSqlStatements, type SourceText } from '../../../shared/ddl';
import { encodePath, type NodePath } from '../../../shared/tree';
import { AdapterError } from '../errors';
import type { ClientSet } from './client';
import { type RunningQuery, runQuery } from './query';

// Postgres DDL (P4 D5). Views and functions are exact one-liners through pg_get_viewdef /
// pg_get_functiondef; tables, matviews and sequences are RECONSTRUCTED from the catalog — the same
// best-effort make DataGrip/DBeaver use, because Postgres has no SHOW CREATE TABLE. The guarantee
// is *complete and CREATE-able*, not byte-identical to pg_dump. Every identifier is quoted via the
// adapter's quoteIdent; every name is a bind parameter.

export interface DdlAdapterFacade {
  clients: ClientSet | null;
  quoteIdent(name: string): string;
}

type Ctx = { opId: string; signal: AbortSignal; setCommand(text: string): void };

interface DdlPart {
  /** The statement text WITHOUT its trailing semicolon. */
  body: string;
  /** Human label for the outline. */
  label: string;
}

export async function ddlFor(
  facade: DdlAdapterFacade,
  path: NodePath,
  ctx: Ctx,
): Promise<SourceText> {
  if (path.segments.length < 3) {
    throw new AdapterError('E_NOT_FOUND', 'cannot render DDL for this path');
  }
  const db = path.segments[0].name;
  const schema = path.segments[1].name;
  const rel = path.segments[2].name;
  const kind = path.segments[2].kind;
  if (!facade.clients) throw new AdapterError('E_CONNECT', 'connection is not open');

  const start = Date.now();
  const lease = await facade.clients.lease(db, ctx.signal);
  try {
    const quote = facade.quoteIdent;
    const qualified = `${quote(schema)}.${quote(rel)}`;

    let parts: DdlPart[] = [];
    switch (kind) {
      case 'view':
        parts = [await viewDdl(facade, lease.value, schema, rel, qualified, 'view', ctx)];
        break;
      case 'matview':
        parts = [await viewDdl(facade, lease.value, schema, rel, qualified, 'matview', ctx)];
        break;
      case 'function':
        parts = [await functionDdl(facade, lease.value, schema, rel, ctx)];
        break;
      case 'sequence':
        parts = await sequenceDdl(facade, lease.value, schema, rel, qualified, ctx);
        break;
      case 'table':
        parts = await tableDdl(facade, lease.value, schema, rel, qualified, ctx);
        break;
      default:
        throw new AdapterError('E_UNSUPPORTED', `no DDL for node kind "${kind}"`);
    }

    const text = parts.map((p) => `${p.body};`).join('\n') + '\n';
    const statements = splitSqlStatements(text, 'postgres');
    return {
      kind: 'ddl',
      path: encodePath(path.segments),
      objectKind: kind as 'table' | 'view' | 'matview' | 'function' | 'sequence' | 'routine',
      name: rel,
      qualifiedName: `${schema}.${rel}`,
      text,
      statements,
      elapsedMs: Date.now() - start,
      fromCache: false,
    };
  } finally {
    lease.release();
  }
}

interface RelationInfo {
  oid: string;
  relkind: string;
  comment: string | null;
}

async function relationInfo(
  facade: DdlAdapterFacade,
  client: Client,
  schema: string,
  rel: string,
  ctx: Ctx,
): Promise<RelationInfo> {
  const rows = await runQuery<{ oid: string; relkind: string; comment: string | null }>(
    client,
    `SELECT c.oid, c.relkind, obj_description(c.oid, 'pg_class') AS comment
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, rel],
    ctx,
    () => {},
  );
  if (rows.length === 0) {
    throw new AdapterError('E_NOT_FOUND', `relation ${schema}.${rel} not found`);
  }
  return { oid: String(rows[0].oid), relkind: String(rows[0].relkind), comment: rows[0].comment };
}

// Views and matviews: the query body is EXACT (pg_get_viewdef); only the wrapper differs.
async function viewDdl(
  facade: DdlAdapterFacade,
  client: Client,
  schema: string,
  rel: string,
  qualified: string,
  kind: 'view' | 'matview',
  ctx: Ctx,
): Promise<DdlPart> {
  const info = await relationInfo(facade, client, schema, rel, ctx);
  const expected = kind === 'view' ? ['v'] : ['m'];
  if (!expected.includes(info.relkind)) {
    throw new AdapterError('E_NOT_FOUND', `${schema}.${rel} is not a ${kind}`);
  }
  const rows = await runQuery<{ def: string }>(
    client,
    `SELECT pg_get_viewdef(c.oid, true) AS def FROM pg_class c WHERE c.oid = $1::oid`,
    [info.oid],
    ctx,
    () => {},
  );
  const def = rows[0]?.def ?? '';
  const head = kind === 'view' ? 'CREATE OR REPLACE VIEW' : 'CREATE MATERIALIZED VIEW';
  return { body: `${head} ${qualified} AS\n${def.trim()}`, label: `${head} ${rel}` };
}

// Functions: EXACT via pg_get_functiondef. The arg-less name lookup is ambiguous for overloaded
// functions and must error rather than guess (R3).
async function functionDdl(
  facade: DdlAdapterFacade,
  client: Client,
  schema: string,
  rel: string,
  ctx: Ctx,
): Promise<DdlPart> {
  const rows = await runQuery<{ oid: string; def: string }>(
    client,
    `SELECT p.oid, pg_get_functiondef(p.oid) AS def
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind IN ('f', 'p')`,
    [schema, rel],
    ctx,
    () => {},
  );
  if (rows.length === 0) {
    throw new AdapterError('E_NOT_FOUND', `function ${schema}.${rel} not found`);
  }
  if (rows.length > 1) {
    throw new AdapterError(
      'E_NOT_FOUND',
      `function ${schema}.${rel} is overloaded (${rows.length} signatures); open a specific one`,
    );
  }
  return { body: rows[0].def.trim(), label: 'CREATE FUNCTION' };
}

// Sequences: reconstructed from pg_sequence. AS/INCREMENT/MINVALUE/MAXVALUE/START/CACHE/CYCLE.
async function sequenceDdl(
  facade: DdlAdapterFacade,
  client: Client,
  schema: string,
  rel: string,
  qualified: string,
  ctx: Ctx,
): Promise<DdlPart[]> {
  const rows = await runQuery<{
    data_type: string;
    seqstart: string;
    seqincrement: string;
    seqmax: string;
    seqmin: string;
    seqcache: string;
    seqcycle: boolean;
  }>(
    client,
    `SELECT format_type(a.atttypid, a.atttypmod) AS data_type,
            s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_sequence s ON s.seqrelid = c.oid
     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = 1
     WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, rel],
    ctx,
    () => {},
  );
  if (rows.length === 0) {
    throw new AdapterError('E_NOT_FOUND', `sequence ${schema}.${rel} not found`);
  }
  const r = rows[0];
  const cycle = r.seqcycle ? 'CYCLE' : 'NO CYCLE';
  const body =
    `CREATE SEQUENCE ${qualified}\n` +
    `  AS ${r.data_type}\n` +
    `  INCREMENT BY ${r.seqincrement}\n` +
    `  MINVALUE ${r.seqmin}\n` +
    `  MAXVALUE ${r.seqmax}\n` +
    `  START WITH ${r.seqstart}\n` +
    `  CACHE ${r.seqcache}\n` +
    `  ${cycle}`;
  return [{ body, label: 'CREATE SEQUENCE' }];
}

interface ColumnDdlRow {
  name: string;
  data_type: string;
  nullable: boolean;
  default_expr: string | null;
  identity: string; // '' | 'a' (ALWAYS) | 'd' (BY DEFAULT)
  generated: string; // '' | 's' (stored)
  comment: string | null;
}

interface ConstraintDdlRow {
  name: string;
  contype: string;
  def: string;
}

interface IndexDdlRow {
  name: string;
  def: string;
}

// Tables: the reconstruction (D5). Order matters for CREATE-ability: columns inline, then
// constraints via pg_get_constraintdef, then indexes via pg_get_indexdef, then comments.
async function tableDdl(
  facade: DdlAdapterFacade,
  client: Client,
  schema: string,
  rel: string,
  qualified: string,
  ctx: Ctx,
): Promise<DdlPart[]> {
  const info = await relationInfo(facade, client, schema, rel, ctx);
  if (info.relkind !== 'r' && info.relkind !== 'p') {
    throw new AdapterError('E_NOT_FOUND', `${schema}.${rel} is not a table`);
  }
  const quote = facade.quoteIdent;

  const cols = await runQuery<ColumnDdlRow>(
    client,
    `SELECT a.attname AS name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            NOT a.attnotnull AS nullable,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr,
            a.attidentity AS identity,
            a.attgenerated AS generated,
            col_description(a.attrelid, a.attnum) AS comment
     FROM pg_attribute a
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = $1::oid AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [info.oid],
    ctx,
    () => {},
  );

  const constraints = await runQuery<ConstraintDdlRow>(
    client,
    `SELECT con.conname AS name, con.contype AS contype,
            pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     WHERE con.conrelid = $1::oid AND con.contype IN ('p', 'u', 'c', 'f')
     ORDER BY CASE con.contype WHEN 'p' THEN 0 WHEN 'u' THEN 1 WHEN 'c' THEN 2 ELSE 3 END,
              con.conname`,
    [info.oid],
    ctx,
    () => {},
  );

  const indexes = await runQuery<IndexDdlRow>(
    client,
    `SELECT i.relname AS name, pg_get_indexdef(ix.indexrelid) AS def
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     WHERE ix.indrelid = $1::oid
       AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = ix.indexrelid)
     ORDER BY i.relname`,
    [info.oid],
    ctx,
    () => {},
  );

  const parts: DdlPart[] = [];

  const columnLines = cols.map((c) => {
    let line = `  ${quote(c.name)} ${c.data_type}`;
    if (c.generated === 's') {
      line += ` GENERATED ALWAYS AS (${c.default_expr ?? ''}) STORED`;
    } else if (c.identity === 'a') {
      line += ' GENERATED ALWAYS AS IDENTITY';
    } else if (c.identity === 'd') {
      line += ' GENERATED BY DEFAULT AS IDENTITY';
    } else if (c.default_expr) {
      line += ` DEFAULT ${c.default_expr}`;
    }
    if (!c.nullable) line += ' NOT NULL';
    return line;
  });
  parts.push({
    body: `CREATE TABLE ${qualified} (\n${columnLines.join(',\n')}\n)`,
    label: 'CREATE TABLE',
  });

  for (const con of constraints) {
    parts.push({
      body: `ALTER TABLE ${qualified} ADD CONSTRAINT ${quote(con.name)} ${con.def}`,
      label: `ADD ${con.contype.toUpperCase()}`,
    });
  }

  for (const idx of indexes) {
    parts.push({ body: idx.def, label: 'CREATE INDEX' });
  }

  if (info.comment) {
    parts.push({
      body: `COMMENT ON TABLE ${qualified} IS ${literal(info.comment)}`,
      label: 'COMMENT',
    });
  }
  for (const c of cols) {
    if (c.comment) {
      parts.push({
        body: `COMMENT ON COLUMN ${qualified}.${quote(c.name)} IS ${literal(c.comment)}`,
        label: 'COMMENT',
      });
    }
  }

  if (parts.length === 1) return parts;
  return parts;
}

// Quote a string literal for COMMENT ON … IS. Postgres string literals escape a quote by doubling it.
function literal(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}
