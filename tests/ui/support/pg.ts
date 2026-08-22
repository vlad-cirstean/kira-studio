// Re-exports the DB suite's Testcontainers harness so `tests/ui/*.spec.ts` can start the same
// Postgres fixture without duplicating it (D22). Playwright runs under Node, so `testcontainers`
// works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type PgFixture, startPostgres } from '../../db/support/postgres';
