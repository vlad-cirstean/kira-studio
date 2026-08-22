import type { QueryResult } from 'pg';
import type { CountRequest, ReadRequest } from '../../../shared/data';
import type { TabularPage } from '../../../shared/page';
import { decodePath, type ObjectMeta, type NodePath } from '../../../shared/tree';
import { encodeTabular } from '../../page/encode';
import { buildCount, buildSelect } from '../../page/sql';
import { AdapterError } from '../errors';
import type { Lease } from '../../lease';
import type { ClientSet } from './client';
import { backendPid, runQueryConfig } from './query';

// Postgres read path (P2 D4, D6). Read queries use pg's raw type parsers so every value arrives as
// the exact text the server rendered (no Date objects, no JSON.parse per jsonb cell), and
// `rowMode: 'array'` feeds encodeTabular without ever building a row object. Catalog queries keep
// the default parsers (catalog.ts is untouched).

// The slice of the adapter this module needs — defined here (not in index.ts) so read.ts is a
// plain function module with no import cycle back to the adapter class.
export interface ReadAdapterFacade {
  clients: ClientSet | null;
  quoteIdent(name: string): string;
  /** describe is used for the PK (keyset eligibility, D6). */
  describe(path: NodePath, ctx: { opId: string; signal: AbortSignal }): Promise<ObjectMeta>;
  /** D11: record which leased backend is running this op, so cancel targets exactly it. */
  registerRunning(opId: string, lease: Lease<unknown> | null, backendPid: number | null): void;
  unregisterRunning(opId: string): void;
}

type Ctx = { opId: string; signal: AbortSignal; setCommand(text: string): void };

// D4: raw parsers for read queries only. `bytea` arrives as `\x…` hex text, decoded in the bytes
// path. `types` is a QueryResult types override.
const RAW = { getTypeParser: () => (v: string) => v };

// OID → encoding (D4). 16 bool, 17 bytea, 20 int8, 21 int2, 23 int4, 26 oid, 700 float4, 701 float8.
// Everything else stays utf8 — numeric/DECIMAL through a double is data corruption.
const OID_ENCODING: Record<number, 'f64' | 'i64' | 'bool' | 'bytes'> = {
  16: 'bool',
  17: 'bytes',
  20: 'i64',
  21: 'f64',
  23: 'f64',
  26: 'f64',
  700: 'f64',
  701: 'f64',
};

// OID → name for the header tooltip; unknown OIDs fall back to `oid:<n>`.
const OID_NAME: Record<number, string> = {
  16: 'bool',
  17: 'bytea',
  20: 'int8',
  21: 'int2',
  23: 'int4',
  25: 'text',
  26: 'oid',
  700: 'float4',
  701: 'float8',
  1043: 'varchar',
  1082: 'date',
  1083: 'time',
  1114: 'timestamp',
  1184: 'timestamptz',
  1700: 'numeric',
  2950: 'uuid',
  3802: 'jsonb',
};

// `bytea` with raw parsers arrives as `\x…` hex. If the server is in bytea_output=escape mode the
// string will not start with `\x` — the caller detects that and falls back to utf8.
function hexToBytes(hex: string): Uint8Array | null {
  if (!hex.startsWith('\\x')) return null;
  const body = hex.slice(2);
  if (body.length % 2 !== 0) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Keyset tokens are base64url(JSON(pkValues)). Decode validates arity against the current PK and
// falls back to offset 0 on mismatch (schema changed under us — R3).
function encodeKeysetToken(values: unknown[]): string {
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

function decodeKeysetToken(token: string, pkLength: number): unknown[] {
  try {
    const json = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== pkLength) return [];
    return parsed;
  } catch {
    return [];
  }
}

// D6 keyset eligibility: is the effective ORDER BY exactly the PK (uniform direction)? Returns the
// direction, or null ⇒ offset paging.
function keysetDirection(orderBy: string, pk: string[]): 'asc' | 'desc' | null {
  const terms = orderBy
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t !== '');
  if (terms.length !== pk.length) return null;
  let direction: 'asc' | 'desc' | null = null;
  for (let i = 0; i < terms.length; i++) {
    const m = /^("[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+(ASC|DESC)$/i.exec(terms[i]);
    if (!m) return null;
    const col = m[1].replaceAll('"', '');
    if (col !== pk[i]) return null;
    const dir = m[2].toLowerCase() as 'asc' | 'desc';
    if (direction === null) direction = dir;
    else if (direction !== dir) return null;
  }
  return direction;
}

export async function readPage(
  facade: ReadAdapterFacade,
  req: ReadRequest,
  ctx: Ctx,
): Promise<TabularPage> {
  const path = decodePath(req.connectionId, req.path);
  if (path.segments.length < 3) throw new AdapterError('E_QUERY', 'cannot read a non-table path');
  const db = path.segments[0].name;
  const schema = path.segments[1].name;
  const rel = path.segments[2].name;
  if (!facade.clients) throw new AdapterError('E_CONNECT', 'connection is not open');

  // Keyset eligibility needs the PK. Get it via describe (L1 metadata source of truth). An empty
  // ORDER BY is the D6 default case (keyset on PK ascending), so the PK is always fetched there;
  // a non-empty ORDER BY is only worth the describe when it could be a PK sort list.
  let pk: string[] | null = null;
  const orderBy = req.orderBy.trim();
  if (orderBy === '' || isPkSortCandidate(orderBy)) {
    try {
      const meta = await facade.describe(path, ctx);
      pk = meta.primaryKey;
    } catch {
      pk = null; // describe failed — fall back to offset paging
    }
  }

  const direction = pk ? keysetDirection(orderBy || defaultPkOrder(pk), pk) : null;
  const lease = await facade.clients.lease(db, ctx.signal);

  try {
    const start = Date.now();
    const pid = backendPid(lease.value);
    facade.registerRunning(ctx.opId, lease, pid);

    let offset: number | null = null;
    let keyset:
      | { columns: string[]; direction: 'asc' | 'desc'; values: unknown[] }
      | null = null;
    let effectiveOrderBy = orderBy;

    if (pk && direction !== null) {
      // Keyset path (D6): default order ⇒ PK ASC; explicit PK sort ⇒ that direction.
      effectiveOrderBy = pk.map((c) => `${facade.quoteIdent(c)} ${direction.toUpperCase()}`).join(', ');
      if (req.cursor.kind === 'keyset') {
        const values = decodeKeysetToken(req.cursor.token, pk.length);
        if (values.length === pk.length) {
          const walkDirection = req.cursor.direction === 'prev' ? flip(direction) : direction;
          keyset = { columns: pk, direction: walkDirection, values };
        } else {
          // Stale token (schema changed under us) — fall back to offset 0, which still keysets.
          offset = 0;
          keyset = { columns: pk, direction, values: [] };
        }
      } else if (req.cursor.kind === 'offset') {
        offset = req.cursor.offset;
        // The first page (offset 0) opens the keyset walk: no row predicate, but nextToken is
        // generated from the last row so paging forward stays on the keyset path.
        if (offset === 0) keyset = { columns: pk, direction, values: [] };
      }
    } else if (req.cursor.kind === 'keyset') {
      // Keyset requested but no PK now — offset 0.
      offset = 0;
    } else {
      offset = req.cursor.offset;
    }

    const { text, params } = buildSelect({
      quote: facade.quoteIdent,
      table: [schema, rel],
      columns: req.projection,
      where: req.where,
      orderBy: effectiveOrderBy,
      keyset,
      limit: req.pageSize + 1, // +1 decides nextToken; dropped before encoding
      offset,
      placeholder: (i) => `$${i}`,
    });

    ctx.setCommand(text);

    const result: QueryResult<unknown[]> = await runQueryConfig<unknown[]>(
      lease.value,
      {
        text,
        values: params as never[],
        rowMode: 'array',
        types: RAW,
      },
      ctx,
      (running) => {
        // Re-register with the pid the query helper observed, in case the client reconnected.
        facade.registerRunning(ctx.opId, lease, running.backendPid);
      },
    );

    const hasNext = result.rows.length > req.pageSize;
    const pageRows = hasNext ? result.rows.slice(0, req.pageSize) : result.rows;
    const rowCount = pageRows.length;

    // Field descriptors carry the OID per column; map to encodings (D4).
    const encodings: Array<{
      name: string;
      dataType: string;
      encoding: 'f64' | 'i64' | 'bool' | 'utf8' | 'bytes';
    }> = result.fields.map((f) => ({
      name: f.name,
      dataType: OID_NAME[f.dataTypeID] ?? `oid:${f.dataTypeID}`,
      encoding: OID_ENCODING[f.dataTypeID] ?? 'utf8',
    }));

    // bytes path: hex-decode `\x…` text; escape-mode strings fall back to utf8 for that column.
    for (let c = 0; c < encodings.length; c++) {
      if (encodings[c].encoding !== 'bytes') continue;
      let fallback = false;
      for (const row of pageRows) {
        const v = row[c];
        if (v == null) continue;
        const hex = hexToBytes(String(v));
        if (hex) row[c] = hex;
        else fallback = true;
      }
      if (fallback) encodings[c].encoding = 'utf8';
    }

    const encoded = encodeTabular({ columns: encodings, rows: pageRows as unknown[][] });

    // nextToken/prevToken from the PK values of the last/first returned row.
    let nextToken: string | null = null;
    let prevToken: string | null = null;
    if (keyset && pk) {
      const idxOf = (name: string): number => encodings.findIndex((e) => e.name === name);
      if (hasNext && rowCount > 0) {
        const last = pageRows[rowCount - 1];
        nextToken = encodeKeysetToken(pk.map((c) => last[idxOf(c)] ?? null));
      }
      if (rowCount > 0) {
        const first = pageRows[0];
        prevToken = encodeKeysetToken(pk.map((c) => first[idxOf(c)] ?? null));
      }
    }

    const absoluteOffset =
      offset !== null
        ? offset
        : req.cursor.kind === 'offset'
          ? req.cursor.offset
          : null;

    return {
      kind: 'tabular',
      columns: encoded.columns,
      rowCount,
      offset: absoluteOffset,
      nextToken,
      prevToken,
      bytes: encoded.bytes,
      truncatedCells: encoded.truncatedCells,
      elapsedMs: Date.now() - start,
      fromCache: false,
    };
  } finally {
    lease.release();
    facade.unregisterRunning(ctx.opId);
  }
}

function flip(direction: 'asc' | 'desc'): 'asc' | 'desc' {
  return direction === 'asc' ? 'desc' : 'asc';
}

function defaultPkOrder(pk: string[]): string {
  return pk.map((c) => `"${c}" ASC`).join(', ');
}

function isPkSortCandidate(orderBy: string): boolean {
  // Only ask describe for the PK when the ORDER BY could plausibly be the PK list.
  return /^(\s*"[^"]+"(\s+(ASC|DESC))?\s*,\s*)*\s*"[^"]+"(\s+(ASC|DESC))?\s*$/i.test(orderBy);
}

export async function countFor(
  facade: ReadAdapterFacade,
  req: CountRequest,
  ctx: Ctx,
): Promise<{ value: number; exact: boolean }> {
  const path = decodePath(req.connectionId, req.path);
  if (path.segments.length < 3) throw new AdapterError('E_QUERY', 'cannot count a non-table path');
  const db = path.segments[0].name;
  const schema = path.segments[1].name;
  const rel = path.segments[2].name;
  if (!facade.clients) throw new AdapterError('E_CONNECT', 'connection is not open');

  const lease = await facade.clients.lease(db, ctx.signal);
  try {
    const pid = backendPid(lease.value);
    facade.registerRunning(ctx.opId, lease, pid);

    if (req.mode === 'exact') {
      const { text } = buildCount({
        quote: facade.quoteIdent,
        table: [schema, rel],
        where: req.where,
      });
      ctx.setCommand(text);
      const result = await runQueryConfig<{ count: string }>(
        lease.value,
        { text, values: [], rowMode: 'array', types: RAW },
        ctx,
        () => {},
      );
      return { value: Number(result.rows[0]?.[0]) ?? 0, exact: true };
    }

    // estimate — only valid with no filter (D8); the renderer must not ask otherwise.
    if (req.where.trim() !== '') {
      throw new AdapterError('E_QUERY', 'estimate count requires an empty filter');
    }
    const text = `SELECT c.reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`;
    ctx.setCommand(text);
    const result = await runQueryConfig<[string]>(
      lease.value,
      { text, values: [schema, rel], rowMode: 'array', types: RAW },
      ctx,
      () => {},
    );
    const reltuples = Number(result.rows[0]?.[0]);
    if (!Number.isFinite(reltuples) || reltuples < 0) return { value: 0, exact: false };
    return { value: Math.floor(reltuples), exact: false };
  } finally {
    lease.release();
    facade.unregisterRunning(ctx.opId);
  }
}
