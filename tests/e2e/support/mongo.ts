// Re-exports the DB suite's Testcontainers harness so `tests/e2e/*.spec.ts` can start the same
// Mongo fixture without duplicating it (D22, mirrors support/mariadb.ts). Playwright runs under
// Node, so `testcontainers` works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export {
  MONGO_ANALYTICS_DATABASE,
  MONGO_DATABASE,
  type MongoFixture,
  startMongo,
} from '../../db/support/mongo';
