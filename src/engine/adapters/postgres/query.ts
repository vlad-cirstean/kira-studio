import type { Client, QueryArrayConfig, QueryConfig, QueryResultRow } from 'pg';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';

export interface RunningQuery {
  backendPid: number;
}

interface PgDriverError {
  code?: string;
  message?: string;
}

// Exported so client.ts can map a raw pg connection-time failure (client.connect() itself,
// before any query has run) the same way a query failure is mapped — an auth failure at
// connect time is just as much an E_AUTH as one hit mid-query.
export function mapPgError(err: unknown): AdapterError {
  const driverCode = (err as PgDriverError | undefined)?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (driverCode === '28P01' || driverCode === '28000') {
    return new AdapterError('E_AUTH', message, err);
  }
  if (driverCode === '57014') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (driverCode === 'ECONNREFUSED' || driverCode === 'ENOTFOUND' || driverCode === 'ETIMEDOUT') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}

export interface QueryOptions {
  rowMode?: 'array';
  /** Identity type parsers — the read path only (D3), never catalog queries. */
  textMode?: boolean;
  /** Appends the bound parameter values to the logged command (§5b step 6), read path only. */
  logParams?: boolean;
}

// The cancellable query helper (§5c). Exported so tests/db/postgres.spec.ts can drive a
// `SELECT pg_sleep(30)` directly to assert server-side cancellation without inventing a fake
// tree level. `opts` is P2's addition: the read path needs `rowMode: 'array'` and identity type
// parsers (D3), and this is extended rather than duplicated so cancellation, tracking and error
// mapping stay in exactly one place — existing (catalog) call sites are unaffected.
export async function runQuery<R extends QueryResultRow = QueryResultRow>(
  client: Client,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
  opts?: QueryOptions,
): Promise<R[]> {
  // Before the statement is issued, not after (Adapter rule 3). The read path asks for the
  // bound values appended so the op log shows the real statement (§5b step 6); catalog callers
  // never pass logParams, so their behaviour is unchanged.
  ctx.setCommand(
    opts?.logParams && params.length > 0 ? `${sql} -- params: ${JSON.stringify(params)}` : sql,
  );

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  const backendPid = (client as unknown as { processID?: number }).processID;
  if (typeof backendPid === 'number') track({ backendPid });

  // pg's `types.getTypeParser` is honoured per-query (verified against pg/lib/result.js: the
  // Result is constructed with `this.types`, and each column parser comes from
  // `types.getTypeParser(oid, format)`) — a per-query identity parser is enough, no need for a
  // second Client constructed with custom `types` (checked 2026-08-22).
  const types = opts?.textMode ? { getTypeParser: () => (v: string) => v } : undefined;

  const issue = (): Promise<{ rows: unknown[] }> => {
    if (opts?.rowMode === 'array') {
      const config: QueryArrayConfig<unknown[]> = {
        text: sql,
        values: params,
        rowMode: 'array',
        ...(types ? { types } : {}),
      };
      return client.query<unknown[]>(config);
    }
    const config: QueryConfig<unknown[]> = {
      text: sql,
      values: params,
      ...(types ? { types } : {}),
    };
    return client.query<QueryResultRow>(config) as unknown as Promise<{ rows: unknown[] }>;
  };

  // `pg` has no per-query abort. The AbortSignal listener below only stops *us* waiting — it
  // does not stop the server from executing the query. The server-side kill is entirely
  // adapter.cancel()'s job (pg_cancel_backend over a side connection, using the backendPid
  // tracked above); engine/scheduler/ops.ts's cancelOp() triggers both, in that order. This is
  // the single most misunderstood part of this design — do not "fix" it by trying to make the
  // query itself abort here.
  return new Promise<R[]>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    issue()
      .then((result) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(result.rows as R[]);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        reject(mapPgError(err));
      });
  });
}

export interface CommandOptions {
  /** setCommand() was already called once for the whole batch (P5 D9) — do not call it again. */
  suppressCommand?: boolean;
}

// mutate.ts's counterpart to runQuery: an UPDATE/DELETE/INSERT/BEGIN/COMMIT/ROLLBACK has no
// `.rows` worth returning — its `rowCount` is the thing every caller actually needs. Cancellation
// and error-mapping are identical to runQuery's; only the settled value and the setCommand
// discipline differ (Adapter rule 3 vs. P5 D9's one-setCommand-per-batch rule).
export async function runCommand(
  client: Client,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
  opts?: CommandOptions,
): Promise<{ rowCount: number }> {
  if (!opts?.suppressCommand) ctx.setCommand(sql);

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  const backendPid = (client as unknown as { processID?: number }).processID;
  if (typeof backendPid === 'number') track({ backendPid });

  return new Promise<{ rowCount: number }>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    client
      .query(sql, params)
      .then((result: { rowCount: number | null }) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        resolve({ rowCount: result.rowCount ?? 0 });
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        reject(mapPgError(err));
      });
  });
}
