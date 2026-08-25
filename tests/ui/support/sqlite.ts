// Re-exports the DB suite's temp-file fixture so `tests/ui/*.spec.ts` can start the same SQLite
// database without duplicating it. Playwright runs under Node, so node:sqlite works here
// unchanged — and unlike every other engine's own support re-export, there is no Docker piece to
// carry along at all (D32/D35): a file-based fixture needs none.
export {
  SQLITE_UNAVAILABLE_MESSAGE,
  type SqliteFixture,
  sqliteAvailable,
  startSqlite,
} from '../../db/support/sqlite';
