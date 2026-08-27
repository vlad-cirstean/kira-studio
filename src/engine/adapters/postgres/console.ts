import {
  type ColumnDescriptor,
  createTabularPageBuilder,
  type TabularPage,
  unpagedPosition,
} from '@shared/protocol/page';
import type { Client, QueryArrayConfig } from 'pg';
import { withAbortRace } from '../abort';
import type { OpCtx } from '../adapter';
import { AdapterError, assertNotCancelled, throwIfCancelled } from '../errors';
import { singleStatusPage } from '../sql-text';
import { mapError } from './errors';
import type { TrackQuery } from './query';
import { normalizeCellText, typeClassFor } from './read';

interface RawField {
  name: string;
  dataTypeID: number;
}

interface RawResult {
  rows: (string | null)[][];
  fields: RawField[];
  command: string;
  rowCount: number | null;
}

// §8.14's own low-level runner, deliberately separate from query.ts's runQuery/runCommand: the
// console needs full field metadata (name + dataTypeID) that runQuery discards, and it must not
// call ctx.setCommand() per statement — execute() below calls it once for the whole batch (P5
// D9's precedent). Always identity-parsed (mirrors read.ts's textMode) so every cell arrives as
// the server's own text representation, with no per-type JS conversion to undo.
async function runRaw(
  client: Client,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: TrackQuery,
): Promise<RawResult> {
  assertNotCancelled(ctx);
  const backendPid = (client as unknown as { processID?: number }).processID;
  const release = typeof backendPid === 'number' ? track({ backendPid }) : undefined;

  const config: QueryArrayConfig<unknown[]> = {
    text: sql,
    values: params,
    rowMode: 'array',
    types: { getTypeParser: () => (v: string) => v },
  };

  return withAbortRace<RawResult>(
    ctx,
    () => client.query(config) as unknown as Promise<RawResult>,
    { release, mapError },
  );
}

// A statement with no output columns (INSERT/UPDATE/DELETE/DDL/…) gets a synthetic single-cell
// page approximating Postgres's own command-complete tag ('INSERT 0 3', 'UPDATE 1', …) — the
// real wire tag is not exposed by node-postgres beyond `.command`/`.rowCount`, so this is a
// documented approximation, not the literal server string.
function buildPage(result: RawResult, typeNames: Map<number, string>): TabularPage {
  if (result.fields.length === 0) {
    return singleStatusPage(`${result.command ?? 'OK'} ${result.rowCount ?? 0}`, 'text');
  }

  const columns: ColumnDescriptor[] = result.fields.map((f) => {
    const dataType = typeNames.get(f.dataTypeID) ?? 'unknown';
    return {
      name: f.name,
      dataType,
      typeClass: typeClassFor(dataType),
      // execute() never consults the catalog (no target relation to describe), so nullability
      // and PK-ness are unknowable here — console results are always read-only regardless.
      nullable: true,
      isPrimaryKey: false,
      generated: false,
    };
  });

  const builder = createTabularPageBuilder(columns);
  for (const row of result.rows) {
    builder.appendRow(
      row.map((v, i) => (v === null ? null : normalizeCellText(v, columns[i].typeClass))),
    );
  }
  return builder.finish(unpagedPosition(result.rows.length));
}

async function lookupTypeNames(
  client: Client,
  ctx: OpCtx,
  track: TrackQuery,
  oids: number[],
): Promise<Map<number, string>> {
  const result = await runRaw(
    client,
    'SELECT oid, typname FROM pg_type WHERE oid = ANY($1::oid[])',
    [oids],
    ctx,
    track,
  );
  const map = new Map<number, string>();
  for (const row of result.rows) {
    const [oid, typname] = row;
    if (oid !== null && typname !== null) map.set(Number(oid), typname);
  }
  return map;
}

export async function execute(
  client: Client,
  ctx: OpCtx,
  track: TrackQuery,
  statements: string[],
): Promise<TabularPage[]> {
  if (statements.length === 0) throw new AdapterError('E_QUERY', 'no statements to execute');
  ctx.setCommand(statements.join(';\n'));

  const results: RawResult[] = [];
  for (const sql of statements) {
    throwIfCancelled(ctx);
    results.push(await runRaw(client, sql, [], ctx, track));
  }

  const oids = new Set<number>();
  for (const r of results) for (const f of r.fields) oids.add(f.dataTypeID);
  const typeNames =
    oids.size > 0 ? await lookupTypeNames(client, ctx, track, [...oids]) : new Map();

  return results.map((r) => buildPage(r, typeNames));
}
