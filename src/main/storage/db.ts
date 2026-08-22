import { chmodSync } from 'node:fs';
import { dbPath } from './paths';

type DatabaseSyncInstance = InstanceType<typeof import('node:sqlite').DatabaseSync>;
export type SqlParam = string | number | bigint | null | Uint8Array;

export interface Db {
  exec(sql: string): void;
  get(sql: string, params?: SqlParam[]): Record<string, unknown> | undefined;
  all(sql: string, params?: SqlParam[]): Record<string, unknown>[];
  run(
    sql: string,
    params?: SqlParam[],
  ): { changes: number | bigint; lastInsertRowid: number | bigint };
  transaction<T>(fn: () => T): T;
  close(): void;
}

export async function openDb(): Promise<Db> {
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

  return {
    exec: (sql) => raw.exec(sql),
    get: (sql, params = []) =>
      raw.prepare(sql).get(...params) as Record<string, unknown> | undefined,
    all: (sql, params = []) => raw.prepare(sql).all(...params) as Record<string, unknown>[],
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
    close: () => raw.close(),
  };
}
