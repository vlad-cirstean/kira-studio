import type { Client, QueryResultRow } from 'pg';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';

export type SqlParam = string | number | bigint | null | Uint8Array;

export interface RunningQuery {
  backendPid: number;
}

// node-postgres sets `processID` on the client after the startup message, but @types/pg does not
// expose it; read it through a narrow cast.
function backendPid(client: Client): number {
  return (client as Client & { processID?: number }).processID ?? -1;
}

// Maps pg errors into AdapterError with the server's message verbatim. SQLSTATE 28P01/28000 are
// auth failures; 57014 is query_canceled; the ECONNREFUSED/ENOTFOUND/ETIMEDOUT system codes are
// connection failures.
export function toAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const e = err as { code?: string; message?: string } | undefined;
  const message = e?.message ?? String(err);
  const code = e?.code;
  if (code === '28P01' || code === '28000') return new AdapterError('E_AUTH', message, err);
  if (code === '57014') return new AdapterError('E_CANCELLED', message, err);
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}

// The cancellable query helper. ctx.setCommand is called first (D20); the backend pid is reported
// through `track` so cancel() can find it. node-postgres has no per-query abort — the abort listener
// stops *us* waiting; the server-side kill is adapter.cancel()'s job (pg_cancel_backend), and both
// run together via cancelOp. Exported so tests/db can drive a `SELECT pg_sleep(30)` directly.
export async function runQuery<R extends QueryResultRow>(
  client: Client,
  sql: string,
  params: SqlParam[],
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
): Promise<R[]> {
  ctx.setCommand(sql);
  if (ctx.signal.aborted) throw new AdapterError('E_CANCELLED', 'cancelled');
  track({ backendPid: backendPid(client) });

  const query = client.query<R>(sql, params);

  // A single promise with rejection handlers attached to both the query and the abort signal from
  // the start — a Promise.race over a separately-created abort promise leaves a transient unhandled
  // rejection window when abort() fires synchronously.
  return new Promise<R[]>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => finish(() => reject(new AdapterError('E_CANCELLED', 'cancelled')));

    ctx.signal.addEventListener('abort', onAbort, { once: true });
    query.then(
      (result) => finish(() => resolve(result.rows)),
      // The server may later reject the query (e.g. 57014 after pg_cancel_backend) once we have
      // already aborted locally; `settled` makes that a no-op so it never surfaces.
      (err) => finish(() => reject(toAdapterError(err))),
    );
  });
}
