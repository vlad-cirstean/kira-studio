import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import { AdapterError } from '../errors';
import { mapError } from './errors';

export interface SqliteHandle {
  readonly db: DatabaseSync;
  readonly file: string;
  readonly readOnly: boolean;
}

// D6: node:sqlite's own default is 0 (fail immediately on a lock) — 5s matches storage/db.ts's
// own `PRAGMA busy_timeout` for Kira's app database.
const BUSY_TIMEOUT_MS = 5000;

// D10/D13: fields mode repurposes `database` for the absolute path (F27); URI mode's
// `sqlite:////abs/path` already round-trips through the existing parser unchanged (F28) — except
// its one asymmetry: parseConnectionUri decodes username/password but never the pathname, so a
// path with a space or other percent-escaped byte arrives here still encoded.
function resolveFilePath(cfg: ResolvedConnectionConfig): string {
  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed?.database) {
      throw new AdapterError('E_CONNECT', 'could not parse the connection URI');
    }
    try {
      return decodeURIComponent(parsed.database);
    } catch {
      return parsed.database;
    }
  }
  const path = cfg.database?.trim();
  if (!path) throw new AdapterError('E_CONNECT', 'no database file path was given');
  return path;
}

// D8: Kira never creates a database. A plain `new DatabaseSync(path)` silently creates an empty
// file at `path` when nothing is there (F7) — the worst failure mode for a tool whose own §1
// promise is that DDL is read-only. Checked before the driver ever touches the path, so a typo
// fails as E_NOT_FOUND rather than "connecting" to a database Kira itself just created.
function assertFileExists(path: string): void {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw new AdapterError('E_NOT_FOUND', `no database file at "${path}"`);
  }
  if (!stat.isFile()) {
    throw new AdapterError('E_CONNECT', `"${path}" is not a regular file`);
  }
}

export async function openDatabase(cfg: ResolvedConnectionConfig): Promise<SqliteHandle> {
  const path = resolveFilePath(cfg);
  assertFileExists(path);

  let sqliteModule: typeof import('node:sqlite');
  try {
    sqliteModule = await import('node:sqlite');
  } catch {
    // Mirrors main/storage/db.ts's own openDb() catch (P0 D2) — a runtime fact, not a database
    // one, so it gets a message naming the actual requirement rather than a bare module-resolution
    // error (F12: this sandbox's own Bun 1.3 has no node:sqlite; 1.4+ does).
    throw new AdapterError(
      'E_CONNECT',
      'node:sqlite is unavailable in this runtime (Bun 1.4+, or Electron/Node 22.5+, is required)',
    );
  }

  const readOnly = cfg.readOnly;
  let db: InstanceType<typeof sqliteModule.DatabaseSync>;
  try {
    db = new sqliteModule.DatabaseSync(path, {
      readOnly,
      timeout: BUSY_TIMEOUT_MS,
      // D6: SQLite's own defaults, written down explicitly rather than left implicit — an unknown
      // option key is accepted silently (F8), so a default is only real once it is stated. Never
      // changed for the user's own file otherwise: no journal_mode, no VACUUM, no ANALYZE, no
      // synchronous — this adapter only *reads* those (ConnectInfo.details), never sets them.
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    });
  } catch (err) {
    throw mapError(err);
  }

  return { db, file: path, readOnly };
}
