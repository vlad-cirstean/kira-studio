import { chmodSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { dbPath } from './paths';

type DatabaseSyncInstance = InstanceType<typeof import('node:sqlite').DatabaseSync>;
type StatementSyncInstance = ReturnType<DatabaseSyncInstance['prepare']>;
export type SqlParam = string | number | bigint | null | Uint8Array;

// D16: fronts raw.prepare with a capped cache — node:sqlite's prepare() re-runs the SQL compiler
// every call, and Drizzle emits a small, stable set of SQL strings, so a cache hit is the normal
// case. The cap matters: repos/ops.ts's pruneOps generates a distinct SQL string per parameter
// count (a fresh `notInArray` list), so an uncapped cache would itself be an unbounded map.
// Eviction is insertion order (a `Map`'s own iteration order); dropped statements are just
// recompiled on next use.
const STMT_CACHE_MAX = 200;

function createStatementCache(raw: DatabaseSyncInstance): (sql: string) => StatementSyncInstance {
  const cache = new Map<string, StatementSyncInstance>();
  return (sql: string): StatementSyncInstance => {
    const cached = cache.get(sql);
    if (cached) return cached;
    const stmt = raw.prepare(sql);
    cache.set(sql, stmt);
    if (cache.size > STMT_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    return stmt;
  };
}

// `schema_version` (migrate.ts) and the startup PRAGMAs have no Drizzle-schema equivalent — they
// keep talking to node:sqlite directly through this narrow raw handle instead of the query builder.
export interface RawDb {
  exec(sql: string): void;
  get(sql: string, params?: SqlParam[]): Record<string, unknown> | undefined;
  run(sql: string, params?: SqlParam[]): void;
  transaction<T>(fn: () => T): T;
}

export type KiraDb = ReturnType<typeof drizzle>;

export interface OpenedDb {
  db: KiraDb;
  raw: RawDb;
  close(): void;
}

export async function openDb(): Promise<OpenedDb> {
  let raw: DatabaseSyncInstance;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    raw = new DatabaseSync(dbPath());
  } catch {
    throw new Error(
      'node:sqlite is unavailable in this Electron build. Swap this file to better-sqlite3 + ' +
        '@electron/rebuild (see D2 in docs/v1/plans/P0-foundations.md) — nothing outside db.ts changes.',
    );
  }

  // Unconditional, not only on create: tightens permissions on an existing loose file too.
  chmodSync(dbPath(), 0o600);

  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');

  const prepare = createStatementCache(raw);

  const db = drizzle(async (sql, params, method) => {
    const stmt = prepare(sql);
    if (method === 'run') {
      stmt.run(...(params as SqlParam[]));
      return { rows: [] };
    }
    // node:sqlite returns objects built in column order, so Object.values(row) preserves the
    // positional order the sqlite-proxy row arrays expect.
    if (method === 'get') {
      const row = stmt.get(...(params as SqlParam[])) as Record<string, unknown> | undefined;
      return { rows: row ? Object.values(row) : [] };
    }
    const rows = stmt.all(...(params as SqlParam[])) as Record<string, unknown>[];
    return { rows: rows.map((row) => Object.values(row)) };
  });

  return {
    db,
    raw: {
      exec: (sql) => raw.exec(sql),
      get: (sql, params = []) => prepare(sql).get(...params) as Record<string, unknown> | undefined,
      run: (sql, params = []) => {
        prepare(sql).run(...params);
      },
      transaction: (fn) => {
        raw.exec('BEGIN');
        try {
          const result = fn();
          raw.exec('COMMIT');
          return result;
        } catch (err) {
          raw.exec('ROLLBACK');
          throw err;
        }
      },
    },
    close: () => raw.close(),
  };
}
