// Re-exports the DB suite's Testcontainers harness so `tests/e2e/*.spec.ts` can start the same
// ClickHouse fixture without duplicating it (P36 D37). Playwright runs under Node, so
// `testcontainers` works here unchanged.

export { type ClickHouseFixture, startClickHouse } from '../../db/support/clickhouse';
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
