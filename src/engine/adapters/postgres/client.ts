import { Client, type ClientConfig } from 'pg';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapPgError } from './query';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_CLIENTS = 8;
const PRIMARY_KEY = '\0primary';

export function buildClientConfig(
  cfg: ResolvedConnectionConfig,
  opts: { database?: string; log: AdapterDeps['log'] },
): ClientConfig {
  const base: ClientConfig = {
    application_name: 'kira-studio',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    // The app cancels explicitly via pg_cancel_backend; a silent server-side statement_timeout
    // would make the stop button's contract a lie.
    statement_timeout: 0,
  };

  if (cfg.mode === 'uri' && cfg.uri) {
    base.connectionString = cfg.uri;
  } else {
    base.host = cfg.host ?? undefined;
    base.port = cfg.port ?? undefined;
    base.user = cfg.username ?? undefined;
    base.password = cfg.password ?? undefined;
  }
  base.database = opts.database ?? cfg.database ?? undefined;

  const sslmode = cfg.options.sslmode;
  if (typeof sslmode === 'string' && sslmode !== 'disable') {
    if (sslmode === 'require' || sslmode === 'prefer') {
      base.ssl = { rejectUnauthorized: false };
    } else if (sslmode === 'verify-full') {
      base.ssl = true;
    } else {
      opts.log('warn', `postgres: unknown sslmode "${sslmode}", ignoring`);
    }
  }

  return base;
}

// Misleadingly-named "Pool" avoided on purpose (D14): one Client per (connection, database),
// never a Pool, because pg_cancel_backend needs a known backend pid and a Pool does not
// reliably tell you which backend ran your query.
export class ClientSet {
  private readonly clients = new Map<string, Client>();
  private readonly lru: string[] = [];

  constructor(
    private readonly cfg: ResolvedConnectionConfig,
    private readonly log: AdapterDeps['log'],
  ) {}

  async get(database: string | null): Promise<Client> {
    const key = database ?? PRIMARY_KEY;
    const existing = this.clients.get(key);
    if (existing) {
      this.touch(key);
      return existing;
    }
    if (this.clients.size >= MAX_CLIENTS) {
      await this.evictLru();
    }
    const client = new Client(
      buildClientConfig(this.cfg, { database: database ?? undefined, log: this.log }),
    );
    try {
      await client.connect();
    } catch (err) {
      throw mapPgError(err);
    }
    this.clients.set(key, client);
    this.touch(key);
    return client;
  }

  primary(): Promise<Client> {
    return this.get(null);
  }

  async closeAll(): Promise<void> {
    const all = [...this.clients.values()];
    this.clients.clear();
    this.lru.length = 0;
    await Promise.all(all.map((client) => client.end().catch(() => {})));
  }

  private touch(key: string): void {
    const idx = this.lru.indexOf(key);
    if (idx >= 0) this.lru.splice(idx, 1);
    this.lru.push(key);
  }

  private async evictLru(): Promise<void> {
    // A user expanding twenty databases should not open twenty backends — evict the
    // least-recently-used non-primary client to make room.
    const victimKey = this.lru.find((key) => key !== PRIMARY_KEY);
    if (!victimKey) return;
    const victim = this.clients.get(victimKey);
    this.clients.delete(victimKey);
    const idx = this.lru.indexOf(victimKey);
    if (idx >= 0) this.lru.splice(idx, 1);
    if (victim) await victim.end().catch(() => {});
  }
}
