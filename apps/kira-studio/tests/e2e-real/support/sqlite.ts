// Re-exports the DB suite's temp-file fixture, mirroring tests/e2e/support/sqlite.ts's own
// precedent — so E1 starts the same real SQLite database without duplicating it. Playwright runs
// under Node here too, so node:sqlite works unchanged, and there is no Docker piece to carry
// along (D32/D35): a file-based fixture needs none.
export {
  SQLITE_UNAVAILABLE_MESSAGE,
  type SqliteFixture,
  sqliteAvailable,
  startSqlite,
} from '../../../../../packages/db-fixtures/support/sqlite';
