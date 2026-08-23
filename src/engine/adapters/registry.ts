import type { ConnectionKind } from '../../shared/domain/connection';
import type { Adapter, AdapterDeps, AdapterFactory } from './adapter';
import { AdapterError } from './errors';
import { createMariaDbAdapter } from './mariadb';
import { createMongoAdapter } from './mongo';
import { createPostgresAdapter } from './postgres';
import { createRedisAdapter } from './redis';

// Explicit object literal, not dynamic import — a v1 with seven adapters is not big enough to
// justify lazy loading, and electron-vite's externalizeDepsPlugin keeps the drivers out of
// the renderer/main bundle regardless.
const factories: Partial<Record<ConnectionKind, AdapterFactory>> = {
  postgres: createPostgresAdapter,
  mariadb: createMariaDbAdapter,
  mongodb: createMongoAdapter,
  redis: createRedisAdapter,
};

export function createAdapter(kind: ConnectionKind, deps: AdapterDeps): Adapter {
  const factory = factories[kind];
  if (!factory) {
    throw new AdapterError('E_UNSUPPORTED', `${kind} connections are not supported yet`);
  }
  return factory(deps);
}
