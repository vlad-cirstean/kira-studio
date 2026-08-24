import type { ConnectionKind } from '../../shared/domain/connection';
import type { Adapter, AdapterDeps } from './adapter';
import { AdapterError } from './errors';

// Lazy per-kind dynamic imports, not static top-of-file ones — each adapter's directory imports
// its own driver at module scope (@confluentinc/kafka-javascript, mongodb, @aws-sdk/client-sqs,
// mariadb, ...), so
// loading all six eagerly meant every driver was resident in the engine process from boot,
// including for a session with a single Postgres connection (measured: >100MB of the engine's
// baseline RSS — P12 memory.spec.ts's lever L-A, docs/v1/PERF.md). This is the only importer of
// these directories, so deferring the import here is enough to defer the driver too.
const loaders: Partial<Record<ConnectionKind, (deps: AdapterDeps) => Promise<Adapter>>> = {
  postgres: async (deps) => (await import('./postgres')).createPostgresAdapter(deps),
  mariadb: async (deps) => (await import('./mariadb')).createMariaDbAdapter(deps),
  mongodb: async (deps) => (await import('./mongo')).createMongoAdapter(deps),
  redis: async (deps) => (await import('./redis')).createRedisAdapter(deps),
  kafka: async (deps) => (await import('./kafka')).createKafkaAdapter(deps),
  sqs: async (deps) => (await import('./sqs')).createSqsAdapter(deps),
  s3: async (deps) => (await import('./s3')).createS3Adapter(deps),
};

export async function createAdapter(kind: ConnectionKind, deps: AdapterDeps): Promise<Adapter> {
  const loader = loaders[kind];
  if (!loader) {
    throw new AdapterError('E_UNSUPPORTED', `${kind} connections are not supported yet`);
  }
  return loader(deps);
}
