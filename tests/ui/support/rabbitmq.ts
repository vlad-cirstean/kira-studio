// Re-exports the DB suite's Testcontainers harness so `tests/ui/*.spec.ts` can start the same
// RabbitMQ fixture without duplicating it (mirrors support/sqs.ts). Playwright runs under Node,
// so `testcontainers` works here unchanged.
export { DOCKER_UNAVAILABLE_MESSAGE, isDockerAvailable } from '../../db/support/docker';
export { type RabbitMqFixture, startRabbitMq } from '../../db/support/rabbitmq';
