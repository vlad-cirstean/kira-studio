import { AdapterError } from '../errors';

interface SqliteDriverError {
  code?: string;
  errcode?: number;
}

// SQLite's own primary result codes (sqlite3.h) — an extended code (e.g. 2067 for
// SQLITE_CONSTRAINT_UNIQUE) always has the primary code in its low byte (F6).
const CANTOPEN = 14;
const NOTADB = 26;
const BUSY = 5;
const LOCKED = 6;
const READONLY = 8;

// P35 D26: classifies by node:sqlite's own numeric `errcode`, never by sniffing `message` text —
// the same discipline mysql-family/query.ts's mapError applies to MariaDB errno. CONSTRAINT (19)
// and plain ERROR (1) fall through to E_QUERY with SQLite's own message verbatim (Adapter rule 4)
// — its constraint messages ("UNIQUE constraint failed: t.a") are already better than anything a
// wrapper would compose.
export function mapError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const e = err as SqliteDriverError | undefined;
  const message = err instanceof Error ? err.message : String(err);

  if (e?.code === 'ERR_SQLITE_ERROR' && e.errcode !== undefined) {
    const primary = e.errcode & 0xff;
    if (primary === CANTOPEN || primary === NOTADB) {
      return new AdapterError('E_CONNECT', message, err);
    }
    if (primary === BUSY || primary === LOCKED) {
      return new AdapterError('E_TIMEOUT', message, err);
    }
    if (primary === READONLY) {
      return new AdapterError('E_UNSUPPORTED', message, err);
    }
  }
  if (e?.code === 'ERR_INVALID_STATE') {
    return new AdapterError('E_CONNECT', message, err);
  }
  return new AdapterError('E_QUERY', message, err);
}
