import type { Connection, FieldInfo, TypeCastFunction, TypeCastNextFunction } from 'mariadb';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';

export interface RunningQuery {
  threadId: number | null;
}

interface MariaDriverError {
  code?: string;
  errno?: number;
}

// Exported so client.ts can map a connect-time failure the same way a query failure is mapped.
export function mapMariaError(err: unknown): AdapterError {
  const e = err as MariaDriverError | undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (e?.errno === 1045 || e?.code === 'ER_ACCESS_DENIED_ERROR') {
    return new AdapterError('E_AUTH', message, err);
  }
  if (e?.errno === 1317 || e?.code === 'ER_QUERY_INTERRUPTED') {
    return new AdapterError('E_CANCELLED', message, err);
  }
  if (
    e?.code === 'ECONNREFUSED' ||
    e?.code === 'ENOTFOUND' ||
    e?.code === 'ETIMEDOUT' ||
    e?.code === 'ER_GET_CONNECTION_TIMEOUT'
  ) {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}

const BINARY_TYPES = new Set(['TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB', 'GEOMETRY', 'BIT']);

// column.string() on a binary column decodes as UTF-8 and mangles the bytes — the MariaDB
// equivalent of Postgres's bytea handling (D3). VAR_STRING/STRING only count as binary when
// the column's own collation is 'binary' (a BINARY/VARBINARY column, not a text one).
const typeCastString: TypeCastFunction = (field: FieldInfo, _next: TypeCastNextFunction) => {
  const isBinaryString =
    (field.type === 'VAR_STRING' || field.type === 'STRING') && field.collation?.name === 'binary';
  if (BINARY_TYPES.has(field.type) || isBinaryString) {
    const buf = field.buffer();
    return buf === null ? null : `0x${buf.toString('hex')}`;
  }
  return field.string();
};

export interface QueryOptions {
  rowsAsArray?: boolean;
  /** Identity string decoding + binary-to-hex (D3) — the read path only, never catalog queries. */
  textMode?: boolean;
  /** Appends the bound parameter values to the logged command (§5b step 6), read path only. */
  logParams?: boolean;
  /** Binary prepared protocol — needed to bind the keyset boundary values (§6c). */
  prepared?: boolean;
}

// The cancellable query helper (§5c), mirroring postgres/query.ts exactly. Exported so
// tests/db/mariadb.spec.ts can drive a `SELECT SLEEP(30)` directly to assert server-side
// cancellation without inventing a fake tree level.
export async function runQuery<R = unknown>(
  conn: Connection,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: (q: RunningQuery) => void,
  opts?: QueryOptions,
): Promise<R[]> {
  ctx.setCommand(
    opts?.logParams && params.length > 0 ? `${sql} -- params: ${JSON.stringify(params)}` : sql,
  );

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  track({ threadId: conn.threadId });

  const queryOptions: { sql: string; rowsAsArray?: boolean; typeCast?: typeof typeCastString } = {
    sql,
    rowsAsArray: opts?.rowsAsArray,
  };
  if (opts?.textMode) queryOptions.typeCast = typeCastString;
  const issue = opts?.prepared ? conn.execute.bind(conn) : conn.query.bind(conn);

  // The connector has no per-query abort. The AbortSignal listener below only stops *us*
  // waiting — the server-side kill is entirely adapter.cancel()'s job (KILL QUERY over a side
  // connection, using the threadId tracked above); engine/scheduler/ops.ts's cancelOp()
  // triggers both, in that order — the same discipline as Postgres's pg_cancel_backend path.
  return new Promise<R[]>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    issue(queryOptions, params)
      .then((rows: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        resolve(rows as R[]);
      })
      .catch((err: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        reject(mapMariaError(err));
      });
  });
}
