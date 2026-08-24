import { Client } from 'pg';

// Re-exports the DB suite's Testcontainers harness so `tests/ui/*.spec.ts` can start the same
// Postgres fixture without duplicating it (D22). Playwright runs under Node, so `testcontainers`
// works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type PgFixture, startPostgres } from '../../db/support/postgres';

const SCROLL_GRID_COLUMNS = 60;
const SCROLL_GRID_ROWS = 5_000;

// P29 D14: neither existing fixture can show the scroll-render gap — wide_table is 60 columns x
// 2 rows, big_rows is 2 columns x many rows — so this creates the wide-AND-tall shape the plan's
// F5/F8 need, against the UI suite's own container (never tests/db/fixtures/0001_seed.sql, which
// every other suite's row counts and ordering already depend on).
/** `app.scroll_grid`: 60 text columns x 5 000 rows, one integer primary key, no foreign keys. */
export async function seedScrollFixture(uri: string): Promise<void> {
  const client = new Client({ connectionString: uri });
  await client.connect();
  try {
    const columns = Array.from({ length: SCROLL_GRID_COLUMNS }, (_, i) => `col${i + 1}`);
    const createCols = columns.map((c) => `${c} text NOT NULL`).join(',\n        ');
    await client.query(`
      CREATE TABLE app.scroll_grid (
        id integer PRIMARY KEY,
        ${createCols}
      );
    `);
    const selectCols = columns
      .map((c, i) => `'row ' || i || ' col ${i + 1}' AS ${c}`)
      .join(',\n        ');
    await client.query(`
      INSERT INTO app.scroll_grid
      SELECT i AS id, ${selectCols}
      FROM generate_series(1, ${SCROLL_GRID_ROWS}) i;
    `);
    await client.query('ANALYZE app.scroll_grid');
  } finally {
    await client.end();
  }
}
