// Re-exports the DB suite's Testcontainers harness so tests/e2e-real/*.spec.ts can start the same
// real MariaDB container without duplicating it, mirroring support/postgres.ts's own precedent.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type MariaFixture, startMariadb } from '../../db/support/mariadb';
