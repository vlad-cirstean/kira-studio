import type { Connection, FieldInfo } from 'mariadb';
import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type PagePosition,
  type TabularPage,
  type TypeClass,
} from '../../../shared/protocol/page';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { singleStatusPage } from '../sql-text';
import { mapError } from './errors';
import { type TrackQuery, typeCastString } from './query';

// Wire-protocol type-name vocabulary (`FieldInfo.type`, e.g. 'TINY', 'VAR_STRING') — distinct
// from read.ts's catalog-string vocabulary ('tinyint(1)', 'varchar(50)'); confirmed against
// node_modules/mariadb/types/share.d.ts's `Types` enum (checked 2026-08-23). Mirrors
// mysql-family/query.ts's typeCastString sets exactly, so a column that is decoded as binary text
// here is classified 'binary' there too.
const BLOB_FAMILY_TYPES = new Set(['TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB']);
const ALWAYS_BINARY_TYPES = new Set(['GEOMETRY', 'BIT']);
const NUMBER_TYPES = new Set([
  'DECIMAL',
  'TINY',
  'SHORT',
  'LONG',
  'FLOAT',
  'DOUBLE',
  'BIGINT',
  'INT24',
  'YEAR',
  'NEWDECIMAL',
]);
const TEMPORAL_TYPES = new Set([
  'TIMESTAMP',
  'DATE',
  'TIME',
  'DATETIME',
  'NEWDATE',
  'TIMESTAMP2',
  'DATETIME2',
  'TIME2',
]);

// tinyint(1) is MariaDB's boolean spelling (§5d) — read.ts detects it from the catalog's
// 'tinyint(1)' display string; execute() has no catalog, so columnLength (the wire protocol's
// analogous display-width field) is the equivalent signal.
function typeClassForField(field: FieldInfo): TypeClass {
  if (field.type === 'TINY' && field.columnLength === 1) return 'boolean';
  if (NUMBER_TYPES.has(field.type)) return 'number';
  if (TEMPORAL_TYPES.has(field.type)) return 'temporal';
  if (field.type === 'JSON') return 'json';
  const isBinaryString =
    (field.type === 'VAR_STRING' || field.type === 'STRING' || BLOB_FAMILY_TYPES.has(field.type)) &&
    field.collation?.name?.toUpperCase() === 'BINARY';
  if (ALWAYS_BINARY_TYPES.has(field.type) || isBinaryString) return 'binary';
  return 'text';
}

type QueryResultShape = ((string | null)[][] & { meta: FieldInfo[] }) | { affectedRows: number };

function isOkPacket(result: QueryResultShape): result is { affectedRows: number } {
  return !Array.isArray(result);
}

// §8.14's own low-level runner, deliberately separate from query.ts's runQuery/runCommand: it
// must not call ctx.setCommand() per statement — execute() below calls it once for the whole
// batch (P5 D9's precedent) — and it needs the driver's raw result shape (array-with-`.meta` vs.
// OkPacket) rather than either of runQuery's/runCommand's narrowed return types.
async function runRaw(
  conn: Connection,
  sql: string,
  ctx: OpCtx,
  track: TrackQuery,
): Promise<QueryResultShape> {
  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }
  const release = track({ threadId: conn.threadId });

  return new Promise<QueryResultShape>((resolve, reject) => {
    let settled = false;
    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      release();
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    conn
      .query({ sql, rowsAsArray: true, typeCast: typeCastString })
      .then((result: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        release();
        resolve(result as QueryResultShape);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        release();
        reject(mapError(err));
      });
  });
}

function buildPage(result: QueryResultShape): TabularPage {
  if (isOkPacket(result)) {
    return singleStatusPage(`${result.affectedRows} row(s) affected`, 'text');
  }

  const fields = result.meta;
  const columns: ColumnDescriptor[] = fields.map((f) => ({
    name: f.name(),
    dataType: f.type,
    typeClass: typeClassForField(f),
    // execute() never consults the catalog — nullability/PK-ness are unknowable here; console
    // results are always read-only regardless.
    nullable: true,
    isPrimaryKey: false,
    generated: false,
  }));

  const builder = createTabularPageBuilder(columns);
  for (const row of result) builder.appendRow(row);
  const position: PagePosition = {
    offset: 0,
    pageSize: result.length,
    hasMore: false,
    nextToken: null,
    prevToken: null,
    strategy: 'offset',
  };
  return builder.finish(position);
}

export async function execute(
  conn: Connection,
  ctx: OpCtx,
  track: TrackQuery,
  statements: string[],
): Promise<TabularPage[]> {
  if (statements.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  ctx.setCommand(statements.join(';\n'));

  const pages: TabularPage[] = [];
  for (const sql of statements) {
    if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'operation was cancelled');
    pages.push(buildPage(await runRaw(conn, sql, ctx, track)));
  }
  return pages;
}
