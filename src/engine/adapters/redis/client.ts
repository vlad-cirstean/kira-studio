import { Redis } from 'ioredis';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { AdapterError } from '../errors';
import { mapRedisError } from './errors';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 8;
const DEFAULT_DB_INDEX = 0;

interface RedisConnectFields {
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  tls: boolean;
}

function resolveFields(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): { fields: RedisConnectFields; defaultDbIndex: number } {
  let host: string;
  let port: number;
  let username: string | null;
  let password: string | null;
  let database: string | null;

  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed) throw new AdapterError('E_CONNECT', 'could not parse the connection URI');
    host = parsed.host ?? 'localhost';
    port = parsed.port ?? 6379;
    username = parsed.username;
    password = parsed.password;
    database = parsed.database;
  } else {
    host = cfg.host ?? 'localhost';
    port = cfg.port ?? 6379;
    username = cfg.username;
    password = cfg.password;
    database = cfg.database;
  }

  const sslmode = cfg.options.sslmode;
  let tls = false;
  if (typeof sslmode === 'string' && sslmode !== 'disable') {
    if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-full') {
      tls = true;
    } else {
      log('warn', `redis: unknown sslmode "${sslmode}", ignoring`);
    }
  }

  const parsedIndex = database && database.trim() !== '' ? Number(database) : Number.NaN;
  const defaultDbIndex =
    Number.isInteger(parsedIndex) && parsedIndex >= 0 ? parsedIndex : DEFAULT_DB_INDEX;

  return { fields: { host, port, username, password, tls }, defaultDbIndex };
}

// Mirrors mariadb/client.ts's ConnectionSet exactly, keyed by logical db index instead of
// database name (P9's D9): one distinct ioredis client per db index, each carrying its own `db`
// option baked in at construction rather than sharing one connection and issuing a runtime
// SELECT — the same reason MariaDB's ConnectionSet holds one Connection per database rather than
// one shared connection running USE.
export class DbConnectionSet {
  private readonly connections = new Map<number, Redis>();
  private readonly lru: number[] = [];

  constructor(
    private readonly fields: RedisConnectFields,
    private readonly defaultDbIndex: number,
    private readonly log: AdapterDeps['log'],
  ) {}

  async get(dbIndex: number): Promise<Redis> {
    const existing = this.connections.get(dbIndex);
    if (existing) {
      this.touch(dbIndex);
      return existing;
    }
    if (this.connections.size >= MAX_CONNECTIONS) {
      await this.evictLru();
    }
    const conn = new Redis({
      host: this.fields.host,
      port: this.fields.port,
      username: this.fields.username ?? undefined,
      password: this.fields.password ?? undefined,
      db: dbIndex,
      lazyConnect: true,
      connectTimeout: CONNECT_TIMEOUT_MS,
      connectionName: 'kira-studio',
      ...(this.fields.tls ? { tls: { rejectUnauthorized: false } } : {}),
    });
    // ioredis's own connect() promise rejects with a generic "Connection is closed" once the
    // socket drops before reaching 'ready' — a handshake failure like WRONGPASS surfaces its
    // real ReplyError only on the 'error' event, which always fires first, so this races it in
    // to give mapRedisError() something it can actually classify as E_AUTH.
    let initError: unknown;
    const captureInitError = (err: unknown): void => {
      initError = err;
    };
    conn.once('error', captureInitError);
    try {
      await conn.connect();
    } catch (err) {
      conn.disconnect();
      throw mapRedisError(initError ?? err);
    } finally {
      conn.removeListener('error', captureInitError);
    }
    // Past the initial handshake, ioredis retries reconnects on its own; without a permanent
    // listener a later transient 'error' event (no listener attached) would crash the whole
    // main process rather than just failing the next command issued on this connection.
    conn.on('error', (err) => this.log('warn', `redis: connection error on db${dbIndex}: ${err}`));
    this.connections.set(dbIndex, conn);
    this.touch(dbIndex);
    return conn;
  }

  primary(): Promise<Redis> {
    return this.get(this.defaultDbIndex);
  }

  async closeAll(): Promise<void> {
    const all = [...this.connections.values()];
    this.connections.clear();
    this.lru.length = 0;
    await Promise.all(all.map((c) => c.quit().catch(() => c.disconnect())));
  }

  private touch(key: number): void {
    const idx = this.lru.indexOf(key);
    if (idx >= 0) this.lru.splice(idx, 1);
    this.lru.push(key);
  }

  private async evictLru(): Promise<void> {
    const victimKey = this.lru.find((key) => key !== this.defaultDbIndex);
    if (victimKey === undefined) return;
    const victim = this.connections.get(victimKey);
    this.connections.delete(victimKey);
    const idx = this.lru.indexOf(victimKey);
    if (idx >= 0) this.lru.splice(idx, 1);
    if (victim) await victim.quit().catch(() => victim.disconnect());
  }
}

export async function connectRedis(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<{ set: DbConnectionSet; defaultDbIndex: number }> {
  const { fields, defaultDbIndex } = resolveFields(cfg, log);
  const set = new DbConnectionSet(fields, defaultDbIndex, log);
  await set.primary(); // eagerly validates the connection, mirrors Mongo's connect()+buildInfo()
  return { set, defaultDbIndex };
}
