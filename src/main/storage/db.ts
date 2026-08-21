import { chmodSync } from 'node:fs';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { dbPath } from './paths';
import * as schema from './schema';

type DatabaseSyncInstance = InstanceType<typeof import('node:sqlite').DatabaseSync>;
export type SqlParam = string | number | bigint | null | Uint8Array;

// The Drizzle instance threaded through the storage modules (Step 13).
export type Db = SqliteRemoteDatabase<typeof schema>;

// Raw access reserved for migrate.ts (multi-statement DDL + schema_version bookkeeping) and for
// the startup PRAGMAs — Drizzle has no `exec` equivalent, and the acceptance criterion allows raw
// SQL only here and in migrate.ts.
export interface RawDb {
  exec(sql: string): void;
  get(sql: string, params?: SqlParam[]): Record<string, unknown> | undefined;
  run(
    sql: string,
    params?: SqlParam[],
  ): { changes: number | bigint; lastInsertRowid: number | bigint };
  transaction<T>(fn: () => T): T;
}

export interface DbHandle {
  db: Db;
  raw: RawDb;
  close(): void;
}

export async function openDb(): Promise<DbHandle> {
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

  // sqlite-proxy bridge (D13a): node:sqlite is synchronous, but the proxy callback is async, so
  // each call resolves immediately. node:sqlite returns rows as objects built in column order, so
  // Object.values() yields the positional arrays the proxy expects. 'get' must return a null rows
  // value for a miss (an empty array would decode into an all-undefined object).
  const db = drizzle(
    async (sql, params, method) => {
      const stmt = raw.prepare(sql);
      switch (method) {
        case 'run':
          stmt.run(...params);
          return { rows: [] };
        case 'all':
          return { rows: stmt.all(...params).map((r) => Object.values(r)) };
        case 'values':
          return { rows: stmt.all(...params).map((r) => Object.values(r)) };
        case 'get': {
          const row = stmt.get(...params);
          return { rows: row ? (Object.values(row) as unknown[]) : null } as { rows: unknown[] };
        }
        default:
          throw new Error(`unsupported proxy method: ${method}`);
      }
    },
    { schema },
  );

  return {
    db,
    raw: {
      exec: (sql) => raw.exec(sql),
      get: (sql, params = []) =>
        raw.prepare(sql).get(...params) as Record<string, unknown> | undefined,
      run: (sql, params = []) => raw.prepare(sql).run(...params),
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
