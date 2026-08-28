// Re-exports the DB suite's Testcontainers harness so `tests/e2e/*.spec.ts` can start the same
// SQS fixture without duplicating it (D22, mirrors support/redis.ts). Playwright runs under
// Node, so `testcontainers` works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type SqsFixture, startSqs } from '../../db/support/sqs';
