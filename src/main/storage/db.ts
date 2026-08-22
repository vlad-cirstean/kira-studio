import { chmodSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { dbPath } from './paths';

type DatabaseSyncInstance = InstanceType<typeof import('node:sqlite').DatabaseSync>;
export type SqlParam = string | number | bigint | null | Uint8Array;

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
        '@electron/rebuild (see D2 in docs/plans/P0-foundations.md) — nothing outside db.ts changes.',
    );
  }

  // Unconditional, not only on create: tightens permissions on an existing loose file too.
  chmodSync(dbPath(), 0o600);

  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA synchronous = NORMAL');
  raw.exec('PRAGMA foreign_keys = ON');
  raw.exec('PRAGMA busy_timeout = 5000');

  const db = drizzle(async (sql, params, method) => {
    const stmt = raw.prepare(sql);
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
      get: (sql, params = []) =>
        raw.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      run: (sql, params = []) => {
        raw.prepare(sql).run(...params);
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
