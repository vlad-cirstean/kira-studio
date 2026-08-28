// Re-exports the DB suite's Testcontainers harness so `tests/e2e/*.spec.ts` can start the same
// S3/LocalStack fixture without duplicating it (D22, mirrors support/sqs.ts). Playwright runs
// under Node, so `testcontainers` works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type S3Fixture, startS3 } from '../../db/support/s3';
