// Re-exports the DB suite's Testcontainers harness so `tests/ui/*.spec.ts` can start the same
// Redis fixture without duplicating it (D22, mirrors support/mongo.ts). Playwright runs under
// Node, so `testcontainers` works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export {
  REDIS_PRIMARY_DB_INDEX,
  REDIS_SECONDARY_DB_INDEX,
  type RedisFixture,
  startRedis,
} from '../../db/support/redis';
