import { resolve } from 'node:path';
import { migrate as drizzleMigrate } from 'drizzle-orm/sqlite-proxy/migrator';
import type { Db, RawDb } from './db';

// Applies drizzle-kit migrations (generated from schema.ts via `bun run db:generate`) using
// drizzle's migrator, which tracks applied migrations by hash in `__drizzle_migrations`. The
// migrator hands back a flat list of SQL statements; we run them in one transaction through the
// raw node:sqlite handle (drizzle has no multi-statement `exec`, but the proxy callback can only
// run prepared single statements, so the raw handle is still the right tool for DDL here).
//
// P1 does not package, so the migrations folder is resolved from the process working directory
// (dev and the Playwright harness both run from the project root). A packaged app must ship the
// `drizzle/` folder and resolve it from `app.getAppPath()` instead.
export async function migrate(db: Db, raw: RawDb): Promise<void> {
  await drizzleMigrate(
    db,
    async (queries) => {
      raw.exec('BEGIN');
      try {
        for (const query of queries) raw.exec(query);
        raw.exec('COMMIT');
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
    { migrationsFolder: resolve(process.cwd(), 'drizzle') },
  );
}
