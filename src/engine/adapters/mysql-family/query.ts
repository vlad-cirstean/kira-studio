import type { Connection, FieldInfo, TypeCastFunction, TypeCastNextFunction } from 'mariadb';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';

export interface RunningQuery {
  threadId: number | null;
}

// P13 D3: the tracker registers a running query and hands back its own release, called once the
// statement settles (resolve, reject, or abort) — the only way `runningByOp` shrinks other than
// `cancel()`/`disconnect()`. The release closure itself does the identity check against what is
// currently registered for the op, so a later statement in the same multi-statement op (mutate's
// transaction, console's "Run all") is never unregistered by an earlier one settling after it.
export type TrackQuery = (q: RunningQuery) => () => void;

interface MariaDriverError {
  code?: string;
  errno?: number;
}

// P34 D4/F4/F5: with a cold server-side SHA2 cache, a plaintext MySQL 8 connection cannot complete
// caching_sha2_password without either TLS or the server's RSA public key — the driver throws
// ER_CANNOT_RETRIEVE_RSA_KEY (errno 45044) rather than a real auth failure, and a `verify-full`
// connection against a self-signed cert throws ER_SELF_SIGNED_SHA256 (45063). Both are, in effect,
// "this credential cannot be verified over this connection" — E_AUTH, not E_QUERY — with a message
// naming both documented remedies rather than the driver's own prose about `cachingRsaPublicKey`,
// which means nothing to a user who typed the right password. Harmless for MariaDB, which has no
// auth plugin that can raise either code.
const RSA_KEY_MESSAGE =
  "MySQL requires an encrypted connection or the server's public key for this account: add " +
  "sslmode=require, or set allowPublicKeyRetrieval=true to accept the server's key over an " +
  'unencrypted connection.';

// Exported so client.ts can map a connect-time failure the same way a query failure is mapped.
export function mapError(err: unknown): AdapterError {
  const e = err as MariaDriverError | undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (e?.errno === 1045 || e?.code === 'ER_ACCESS_DENIED_ERROR') {
    return new AdapterError('E_AUTH', message, err);
  }
  if (e?.errno === 45044 || e?.code === 'ER_CANNOT_RETRIEVE_RSA_KEY') {
    return new AdapterError('E_AUTH', RSA_KEY_MESSAGE, err);
  }
  if (e?.errno === 45063 || e?.code === 'ER_SELF_SIGNED_SHA256') {
    return new AdapterError('E_AUTH', RSA_KEY_MESSAGE, err);
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

// The wire protocol has no distinct TEXT type code — TEXT/TINYTEXT/MEDIUMTEXT/LONGTEXT share the
// exact same BLOB-family type codes as their binary counterparts, distinguished only by the
// column's collation (binary collation = a real BLOB; any other = TEXT). GEOMETRY and BIT have no
// such ambiguity — always binary.
const BLOB_FAMILY_TYPES = new Set(['TINY_BLOB', 'MEDIUM_BLOB', 'LONG_BLOB', 'BLOB']);
const ALWAYS_BINARY_TYPES = new Set(['GEOMETRY', 'BIT']);

// column.string() on a binary column decodes as UTF-8 and mangles the bytes — the MariaDB
// equivalent of Postgres's bytea handling (D3). VAR_STRING/STRING/the BLOB family only count as
// binary when the column's own collation is the binary collation (a BINARY/VARBINARY/BLOB column,
// not a TEXT/CHAR/VARCHAR one) — the driver's Collation table names it 'BINARY' (uppercase), so
// this compares case-insensitively rather than assuming a casing.
// Exported so mysql-family/console.ts (P5.5) can reuse the exact same binary/text decoding — the
// query console needs the identical hex-normalisation discipline the read path already has.
export const typeCastString: TypeCastFunction = (field: FieldInfo, _next: TypeCastNextFunction) => {
  const isBinaryString =
    (field.type === 'VAR_STRING' || field.type === 'STRING' || BLOB_FAMILY_TYPES.has(field.type)) &&
    field.collation?.name?.toUpperCase() === 'BINARY';
  if (ALWAYS_BINARY_TYPES.has(field.type) || isBinaryString) {
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
}

// The cancellable query helper (§5c), mirroring postgres/query.ts exactly. Exported so
// tests/db/mariadb.spec.ts can drive a `SELECT SLEEP(30)` directly to assert server-side
// cancellation without inventing a fake tree level.
export async function runQuery<R = unknown>(
  conn: Connection,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: TrackQuery,
  opts?: QueryOptions,
): Promise<R[]> {
  ctx.setCommand(
    opts?.logParams && params.length > 0 ? `${sql} -- params: ${JSON.stringify(params)}` : sql,
  );

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  const release = track({ threadId: conn.threadId });

  const queryOptions: { sql: string; rowsAsArray?: boolean; typeCast?: typeof typeCastString } = {
    sql,
    rowsAsArray: opts?.rowsAsArray,
  };
  if (opts?.textMode) queryOptions.typeCast = typeCastString;
  // Always the text protocol (conn.query), never conn.execute()'s binary/prepared protocol:
  // params still bind safely via query()'s own client-side `?` escaping, and the binary protocol
  // combined with the textMode typeCast callback above corrupts row data (confirmed with real
  // bound params, not just param-less queries).
  const issue = conn.query.bind(conn);

  // The connector has no per-query abort. The AbortSignal listener below only stops *us*
  // waiting — the server-side kill is entirely adapter.cancel()'s job (KILL QUERY over a side
  // connection, using the threadId tracked above); engine/scheduler/ops.ts's cancelOp()
  // triggers both, in that order — the same discipline as Postgres's pg_cancel_backend path.
  return new Promise<R[]>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      release();
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    issue(queryOptions, params)
      .then((rows: unknown) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        release();
        resolve(rows as R[]);
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

export interface CommandOptions {
  /** setCommand() was already called once for the whole batch (P5 D9) — do not call it again. */
  suppressCommand?: boolean;
}

// mutate.ts's counterpart to runQuery: for a non-SELECT statement, `conn.query()` resolves an
// OkPacket-shaped object (`{ affectedRows, insertId, warningStatus }`), not an array of rows —
// this is what every mutate.ts caller actually needs. Cancellation and error-mapping mirror
// runQuery's; only the settled value and the setCommand discipline differ.
export async function runCommand(
  conn: Connection,
  sql: string,
  params: unknown[],
  ctx: OpCtx,
  track: TrackQuery,
  opts?: CommandOptions,
): Promise<{ affectedRows: number }> {
  if (!opts?.suppressCommand) ctx.setCommand(sql);

  if (ctx.signal.aborted) {
    throw new AdapterError('E_CANCELLED', 'operation was cancelled before it started');
  }

  const release = track({ threadId: conn.threadId });

  return new Promise<{ affectedRows: number }>((resolve, reject) => {
    let settled = false;

    const onAbort = (): void => {
      if (settled) return;
      settled = true;
      release();
      reject(new AdapterError('E_CANCELLED', 'operation was cancelled'));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    conn
      .query({ sql }, params)
      .then((result: { affectedRows?: number }) => {
        if (settled) return;
        settled = true;
        ctx.signal.removeEventListener('abort', onAbort);
        release();
        resolve({ affectedRows: result.affectedRows ?? 0 });
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
