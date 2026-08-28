// Re-exports the DB suite's Testcontainers harness so `tests/e2e/*.spec.ts` can start the same
// MySQL fixture without duplicating it (D31). Playwright runs under Node, so `testcontainers`
// works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type MysqlFixture, startMysql } from '../../db/support/mysql';
