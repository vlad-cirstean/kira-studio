import { Client, type ClientConfig } from 'pg';
import type { ResolvedConnectionConfig } from '../../../shared/engine-ops';

// D14: one Client per (connection, database) — not a Pool — so pg_cancel_backend can target the
// exact backend. The primary client is the configured database; `get(name)` opens a per-database
// client for the multi-database tree. Bound at 8 databases, LRU-evicting non-primary clients.

const MAX_CLIENTS = 8;

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
  private readonly clients = new Map<string, Client>();
  private readonly order: string[] = [];
  private primaryClient: Client | null = null;

  constructor(cfg: ResolvedConnectionConfig, warn?: (m: string) => void) {
    this.config = buildClientConfig(cfg, warn);
  }

  primary(): Promise<Client> {
    return this.get(null);
  }

  private async open(database: string | null): Promise<Client> {
    const client = new Client(database === null ? this.config : { ...this.config, database });
    await client.connect();
    return client;
  }

  async get(database: string | null): Promise<Client> {
    if (database === null) {
      if (!this.primaryClient) this.primaryClient = await this.open(null);
      return this.primaryClient;
    }
    const existing = this.clients.get(database);
    if (existing) {
      this.touch(database);
      return existing;
    }
    if (this.clients.size >= MAX_CLIENTS) this.evictLru();
    const client = await this.open(database);
    this.clients.set(database, client);
    this.order.unshift(database);
    return client;
  }

  private touch(database: string): void {
    const i = this.order.indexOf(database);
    if (i >= 0) this.order.splice(i, 1);
    this.order.unshift(database);
  }

  private evictLru(): void {
    for (let i = this.order.length - 1; i >= 0; i--) {
      const db = this.order[i];
      const client = this.clients.get(db);
      if (!client) continue;
      this.order.splice(i, 1);
      this.clients.delete(db);
      void client.end().catch(() => {});
      return;
    }
  }

  async closeAll(): Promise<void> {
    const clients = [this.primaryClient, ...this.clients.values()];
    this.primaryClient = null;
    this.clients.clear();
    this.order.length = 0;
    await Promise.all(clients.filter(Boolean).map((c) => (c as Client).end().catch(() => {})));
  }
}

// pg_cancel_backend on a fresh side connection (D14). The caller resolves the backend pid from its
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
