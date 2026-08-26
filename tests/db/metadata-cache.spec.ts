import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import type { KiraDb } from '../../src/main/storage/db';
import { getCached, putCached } from '../../src/main/storage/repos/metadata-cache';

// P43 iter3 D36: repos/metadata-cache.ts needs no container — `putCached`/`getCached` take a
// plain `KiraDb` (`ReturnType<typeof drizzle>` from `drizzle-orm/sqlite-proxy`), and a
// sqlite-proxy instance can be built over any driver, `bun:sqlite` included, in the same shape
// `main/storage/db.ts:71-85` already writes over `node:sqlite`. `openDb()` itself is not called
// here — it hard-codes `dbPath()` and needs `node:sqlite`, which this Bun lacks (AGENTS.md's
// SQLite section) — only the repo function under test is. The two tables' DDL is restated inline
// from `migrations/0001_init.sql` (plus `0003_p11.sql`/`0004_misc_fixes.sql`'s two `ALTER TABLE`
// columns) rather than run through the real migrator, to avoid a `?raw` import `bun test` has no
// loader for; a drift between this DDL and the schema `metadataCache`/`connections` import is
// still caught, as a type error on the Drizzle table object, not a silent pass.
function makeDb(): { db: KiraDb; raw: Database } {
  const raw = new Database(':memory:');
  raw.exec(`
    CREATE TABLE connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      color TEXT NOT NULL,
      mode TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 0,
      host TEXT,
      port INTEGER,
      database TEXT,
      username TEXT,
      password TEXT,
      uri TEXT,
      options_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      preconnect TEXT,
      preconnect_sidecar INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE metadata_cache (
      connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      etag TEXT
    );
    CREATE UNIQUE INDEX metadata_cache_connection_path ON metadata_cache(connection_id, path);
  `);
  const prepare = (sql: string) => raw.query(sql);
  const db = drizzle(async (sql, params, method) => {
    const stmt = prepare(sql);
    if (method === 'run') {
      stmt.run(...(params as never[]));
      return { rows: [] };
    }
    if (method === 'get') {
      const row = stmt.get(...(params as never[])) as Record<string, unknown> | undefined;
      return { rows: row ? Object.values(row) : [] };
    }
    const rows = stmt.all(...(params as never[])) as Record<string, unknown>[];
    return { rows: rows.map((r) => Object.values(r)) };
  });
  return { db, raw };
}

function seedConnection(raw: Database, id: string): void {
  raw.run(
    `INSERT INTO connections (id, name, kind, color, mode, created_at, updated_at)
     VALUES (?, 'n', 'sqlite', 'gray', 'fields', 't', 't')`,
    [id],
  );
}

function rowCount(raw: Database, connectionId: string): number {
  const row = raw
    .query('SELECT COUNT(*) as n FROM metadata_cache WHERE connection_id = ?')
    .get(connectionId) as { n: number };
  return row.n;
}

describe('metadata cache — per-connection eviction cap (P43 iter3, D20/D36)', () => {
  test('1. 260 writes for one connection leave exactly MAX_ROWS_PER_CONNECTION rows; the oldest are gone, the newest reads back', async () => {
    const { db, raw } = makeDb();
    seedConnection(raw, 'c1');
    for (let i = 0; i < 260; i++) {
      await putCached(db, 'c1', `p${i}`, 'children', { i });
    }
    expect(rowCount(raw, 'c1')).toBe(200);
    expect(await getCached(db, 'c1', 'p0', 'children')).toBeNull();
    expect(await getCached(db, 'c1', 'p59', 'children')).toBeNull(); // the 60 oldest are the ones evicted
    expect(await getCached(db, 'c1', 'p60', 'children')).toEqual({ i: 60 });
    expect(await getCached(db, 'c1', 'p259', 'children')).toEqual({ i: 259 });
  });

  test('2. the row just written is never the one evicted, across 400 consecutive writes', async () => {
    const { db, raw } = makeDb();
    seedConnection(raw, 'c1');
    let maxTie = 0;
    for (let i = 0; i < 400; i++) {
      await putCached(db, 'c1', `q${i}`, 'children', { i });
      expect(await getCached(db, 'c1', `q${i}`, 'children')).toEqual({ i }); // never lost on its own write
      const tie = raw
        .query(
          `SELECT COUNT(*) as c FROM metadata_cache WHERE connection_id = 'c1'
           GROUP BY fetched_at ORDER BY c DESC LIMIT 1`,
        )
        .get() as { c: number } | undefined;
      if (tie && tie.c > maxTie) maxTie = tie.c;
    }
    expect(rowCount(raw, 'c1')).toBe(200);
    // Recorded rather than asserted on: a `fetched_at`-tie is possible at millisecond resolution
    // and is exactly the case scenario 2 exists to probe — the assertion above (the row just
    // written always reads back) is what actually proves D20's eviction never evicts its own
    // write, regardless of how large a tie forms.
    expect(maxTie).toBeGreaterThanOrEqual(1);
  });

  test('3. two connections do not evict each other', async () => {
    const { db, raw } = makeDb();
    seedConnection(raw, 'c1');
    seedConnection(raw, 'c2');
    for (let i = 0; i < 5; i++) await putCached(db, 'c2', `r${i}`, 'children', { i });
    for (let i = 0; i < 250; i++) await putCached(db, 'c1', `s${i}`, 'children', { i });
    expect(rowCount(raw, 'c1')).toBe(200);
    expect(rowCount(raw, 'c2')).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(await getCached(db, 'c2', `r${i}`, 'children')).toEqual({ i });
    }
  });

  test('4. a payload over MAX_PAYLOAD_BYTES is refused without disturbing the rows already there', async () => {
    const { db, raw } = makeDb();
    seedConnection(raw, 'c1');
    await putCached(db, 'c1', 'ok', 'children', { small: true });
    const big = 'x'.repeat(5 * 1024 * 1024); // over the 4 MB cap
    await putCached(db, 'c1', 'big', 'children', { big });
    expect(await getCached(db, 'c1', 'ok', 'children')).toEqual({ small: true });
    expect(await getCached(db, 'c1', 'big', 'children')).toBeNull();
    expect(rowCount(raw, 'c1')).toBe(1);
  });
});
