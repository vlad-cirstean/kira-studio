import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import type { ClickHouseHandle } from './client';
import { mapError } from './errors';

export interface RunningQuery {
  queryId: string;
}

// P13 D3's tracker shape, reused verbatim (mysql-family/query.ts, sqlite/console.ts's own
// discipline): registers the query about to run and hands back its own release, identity-checked
// against what is currently registered for the op so a later statement in the same multi-
// statement op (mutate's insert batch, console's "Run all") is never unregistered by an earlier
// one settling after it.
export type TrackQuery = (q: RunningQuery) => () => void;

export function checkNotCancelled(ctx: OpCtx): void {
  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }
}

// D8: an aborted request surfaces from the driver as a plain, uncoded Error ("The user aborted a
// request.", verified empirically — it is not a ClickHouseError and carries no `code`), so
// mapError alone cannot classify it. Checking ctx.signal.aborted directly after the catch is the
// reliable path: it doesn't depend on the driver's exact error text or type.
function mapQueryError(ctx: OpCtx, err: unknown): AdapterError {
  if (ctx.signal.aborted) return new AdapterError('E_CANCELLED', 'operation was cancelled', err);
  return mapError(err);
}

function readonlySettings(h: ClickHouseHandle): Record<string, string | number> {
  // D7: sent per request, not baked into the client (client.ts's own comment) — every data,
  // console and mutation request gets it; the cancel path's KILL QUERY never does.
  return h.readOnly ? { readonly: 2 } : {};
}

// The client's own `database` option is set once at connect time (client.ts's openClient) —
// query()/command()/exec() have no per-request database override in this driver's HTTP-only API
// (verified against the client's own type declarations), so every statement this adapter writes
// is fully qualified with schema.table instead (D19), never relying on an implicit "current"
// database the way a stateful session would.
export interface RunOptions {
  /** D8: the query_id KILL QUERY will match on. */
  queryId: string;
}

// The *Strings JSON formats (JSONCompactStringsEachRow* below) render every Nullable NULL as this
// literal small-caps string instead of JSON null — chosen by ClickHouse itself specifically so it
// can't collide with an empty string, verified empirically against clickhouse-server:26.3 (a
// Nullable(String) NULL and '' come back as "ᴺᵁᴸᴸ" and "" respectively, never JSON `null`). Not
// documented anywhere the adapter can link to; the sentinel itself is the only reliable signal.
const NULL_SENTINEL = 'ᴺᵁᴸᴸ'; // "ᴺᵁᴸᴸ"

function decodeRow(values: (string | null)[]): (string | null)[] {
  return values.map((v) => (v === NULL_SENTINEL ? null : v));
}

/** Streams a row-returning statement, one values-array per row, on D16's wire format — the
 *  first row is column names, the second is column types, everything after is data. Registers
 *  itself with `track` but never calls `ctx.setCommand()`: `console.ts`'s execute() calls it once
 *  for the whole batch (P5 D9's precedent) and `read.ts` calls it itself before this runs. */
export async function streamQuery(
  h: ClickHouseHandle,
  ctx: OpCtx,
  sql: string,
  opts: RunOptions,
  track: TrackQuery,
  onHeader: (names: string[], types: string[]) => void,
  onRow: (values: (string | null)[]) => void,
): Promise<void> {
  checkNotCancelled(ctx);
  const release = track({ queryId: opts.queryId });
  try {
    const resultSet = await h.client.query({
      query: sql,
      format: 'JSONCompactStringsEachRowWithNamesAndTypes',
      query_id: opts.queryId,
      abort_signal: ctx.signal,
      clickhouse_settings: readonlySettings(h),
    });
    let rowIndex = 0;
    let names: string[] = [];
    for await (const chunk of resultSet.stream<(string | null)[]>()) {
      for (const row of chunk) {
        const values = row.json();
        if (rowIndex === 0) {
          // The names row is never null (F25's own example), so this cast is safe.
          names = values as string[];
        } else if (rowIndex === 1) {
          onHeader(names, values as string[]);
        } else {
          onRow(decodeRow(values));
        }
        rowIndex++;
      }
    }
  } catch (err) {
    throw mapQueryError(ctx, err);
  } finally {
    release();
  }
}

/** Executes a non-row-returning statement (INSERT, DDL) via `command()` — never appends a
 *  FORMAT clause the way `query()` does, which matters here: an INSERT's own `FORMAT` names the
 *  *input* data's format, not an output format, so appending one would be a different statement
 *  entirely. Same no-`setCommand()` rule as `streamQuery`. */
export async function runCommand(
  h: ClickHouseHandle,
  ctx: OpCtx,
  sql: string,
  opts: RunOptions,
  track: TrackQuery,
): Promise<{ writtenRows: number }> {
  checkNotCancelled(ctx);
  const release = track({ queryId: opts.queryId });
  try {
    const result = await h.client.command({
      query: sql,
      query_id: opts.queryId,
      abort_signal: ctx.signal,
      clickhouse_settings: readonlySettings(h),
    });
    return { writtenRows: Number(result.summary?.written_rows ?? '0') };
  } catch (err) {
    throw mapQueryError(ctx, err);
  } finally {
    release();
  }
}

/** The catalog/read path's own entry point: calls `ctx.setCommand()` (Adapter rule 3), binds
 *  `params` as real ClickHouse query parameters (`{name:Type}` placeholders, D19 — never
 *  interpolated), and returns the parsed rows as plain objects (`FORMAT JSON`, not D16's streamed
 *  string-array shape — catalog rows are small metadata, not data the page builder needs to see
 *  as pre-stringified text). */
export async function runCatalogQuery<T = Record<string, unknown>>(
  h: ClickHouseHandle,
  ctx: OpCtx,
  sql: string,
  opts: RunOptions,
  track: TrackQuery,
  params?: Record<string, string>,
): Promise<T[]> {
  checkNotCancelled(ctx);
  ctx.setCommand(sql);
  const release = track({ queryId: opts.queryId });
  try {
    const resultSet = await h.client.query({
      query: sql,
      format: 'JSON',
      query_id: opts.queryId,
      query_params: params,
      abort_signal: ctx.signal,
      clickhouse_settings: readonlySettings(h),
    });
    const parsed = await resultSet.json<T>();
    return parsed.data;
  } catch (err) {
    throw mapQueryError(ctx, err);
  } finally {
    release();
  }
}
