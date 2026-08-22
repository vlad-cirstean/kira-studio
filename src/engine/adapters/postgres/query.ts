import type { Client, QueryResultRow } from 'pg';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';

export interface RunningQuery {
  backendPid: number;
}

interface PgDriverError {
  code?: string;
  message?: string;
}

function mapPgError(err: unknown): AdapterError {
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

// The cancellable query helper (§5c). Exported so tests/db/postgres.spec.ts can drive a
// `SELECT pg_sleep(30)` directly to assert server-side cancellation without inventing a fake
// tree level.
export async function runQuery<R extends QueryResultRow = QueryResultRow>(
  client: Client,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
): Promise<R[]> {
  ctx.setCommand(sql); // before the statement is issued, not after (Adapter rule 3)

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  const backendPid = (client as unknown as { processID?: number }).processID;
  if (typeof backendPid === 'number') track({ backendPid });

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

    client
      .query<R>(sql, params)
      .then((result) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(result.rows);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        reject(mapPgError(err));
      });
  });
}
