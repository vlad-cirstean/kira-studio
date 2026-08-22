import { Client, type ClientConfig } from 'pg';
import type { ResolvedConnectionConfig } from '../../../shared/engine-ops';
import { LeasePool, type Lease } from '../../lease';

// D11: exclusive leases, not one shared Client per database. P2 runs read + count + prefetch
// concurrently on one connection, and `pg_cancel_backend(pid)` cancels *whatever that backend is
// currently running* — so a shared client would let the stop button kill the wrong query. Each
// database gets a LeasePool<Client> of max 3, still bounded at MAX_DATABASES databases, LRU-evicting
// non-primary pools.

const MAX_DATABASES = 8;
const LEASES_PER_DB = 3;

export function buildClientConfig(
  cfg: ResolvedConnectionConfig,
  warn?: (message: string) => void,
): ClientConfig {
  const base: ClientConfig = {
    application_name: 'kira-studio',
    connectionTimeoutMillis: 10_000,
    statement_timeout: 0, // the app cancels explicitly; a silent server timeout would break the stop-button contract
  };

  if (cfg.mode === 'uri' && cfg.uri) {
    return { ...base, connectionString: cfg.uri };
  }

  const out: ClientConfig = {
    ...base,
    host: cfg.host ?? undefined,
    port: cfg.port ?? undefined,
    database: cfg.database ?? undefined,
    user: cfg.username ?? undefined,
    password: cfg.password ?? undefined,
  };

  const sslmode = typeof cfg.options?.sslmode === 'string' ? cfg.options.sslmode : undefined;
  if (sslmode) {
    if (sslmode === 'require' || sslmode === 'prefer') out.ssl = { rejectUnauthorized: false };
    else if (sslmode === 'verify-full' || sslmode === 'verify-ca') out.ssl = true;
    else warn?.(`unknown sslmode "${sslmode}" ignored`);
  }
  for (const key of Object.keys(cfg.options ?? {})) {
    if (key !== 'sslmode') warn?.(`unknown option "${key}" ignored in fields mode`);
  }
  return out;
}

export class ClientSet {
  private readonly config: ClientConfig;
  private readonly pools = new Map<string, LeasePool<Client>>();
  private readonly order: string[] = [];
  private primaryPool: LeasePool<Client> | null = null;

  constructor(cfg: ResolvedConnectionConfig, warn?: (m: string) => void) {
    this.config = buildClientConfig(cfg, warn);
  }

  private poolFor(database: string | null): LeasePool<Client> {
    if (database === null) {
      this.primaryPool ??= this.makePool(null);
      return this.primaryPool;
    }
    let pool = this.pools.get(database);
    if (pool) {
      this.touch(database);
      return pool;
    }
    if (this.pools.size >= MAX_DATABASES) this.evictLru();
    pool = this.makePool(database);
    this.pools.set(database, pool);
    this.order.unshift(database);
    return pool;
  }

  private makePool(database: string | null): LeasePool<Client> {
    return new LeasePool<Client>({
      max: LEASES_PER_DB,
      open: async () => {
        const client = new Client(database === null ? this.config : { ...this.config, database });
        await client.connect();
        return client;
      },
      close: async (client) => {
        await client.end().catch(() => {});
      },
    });
  }

  /** Exclusive lease of the connection for `database` (D11). */
  lease(database: string | null, signal?: AbortSignal): Promise<Lease<Client>> {
    return this.poolFor(database).acquire(signal);
  }

  private touch(database: string): void {
    const i = this.order.indexOf(database);
    if (i >= 0) this.order.splice(i, 1);
    this.order.unshift(database);
  }

  private evictLru(): void {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const db = this.order[i];
      const pool = this.pools.get(db);
      if (!pool) continue;
      this.order.splice(i, 1);
      this.pools.delete(db);
      void pool.closeAll();
      return;
    }
  }

  async closeAll(): Promise<void> {
    const pools = [this.primaryPool, ...this.pools.values()];
    this.primaryPool = null;
    this.pools.clear();
    this.order.length = 0;
    await Promise.all(pools.filter(Boolean).map((p) => (p as LeasePool<Client>).closeAll()));
  }
}

// pg_cancel_backend on a fresh side connection (D11). The caller resolves the backend pid from its
// running-query map. Returns the boolean the server returned (true = cancel signal sent).
export async function cancelBackend(config: ClientConfig, backendPid: number): Promise<boolean> {
  const client = new Client(config);
  try {
    await client.connect();
    const result = await client.query('SELECT pg_cancel_backend($1)', [backendPid]);
    return result.rows[0]?.pg_cancel_backend === true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {});
  }
}
