import { type Connection, type ConnectionConfig, createConnection } from 'mariadb';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { AdapterError } from '../errors';
import type { MysqlFamilyProfile } from './profile';
import { mapError } from './query';

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_CONNECTIONS = 8;
const PRIMARY_KEY = '\0primary';

export function buildConnectionOptions(
  cfg: ResolvedConnectionConfig,
  opts: {
    database?: string;
    log: AdapterDeps['log'];
    applyEngineOptions: MysqlFamilyProfile['applyEngineOptions'];
  },
): ConnectionConfig {
  const base: ConnectionConfig = {
    connectTimeout: CONNECT_TIMEOUT_MS,
    // Explicit even though it is the connector's own default — D9 depends on this switch, and
    // an explicit line is what stops a later phase flipping it for an unrelated reason.
    multipleStatements: false,
    allowPublicKeyRetrieval: false,
    metaAsArray: false,
    trace: false,
    connectAttributes: { program_name: 'kira-studio' },
  };

  if (cfg.mode === 'uri' && cfg.uri) {
    // mariadb's own createConnection(string) parser requires the literal `mariadb://` scheme
    // and a non-empty database path segment (lib/config/connection-options.js's `urlFormat`
    // regex), and — unlike `pg`, which merges an explicit `database` onto a `connectionString`
    // — offers no way to layer a per-database override on top of a parsed string. Parsed into
    // fields here instead, via the same shared/domain/uri.ts parser the connection dialog
    // already uses, so a database override always works regardless of mode (checked 2026-08-22).
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed) throw new AdapterError('E_CONNECT', 'could not parse the connection URI');
    base.host = parsed.host ?? undefined;
    base.port = parsed.port ?? undefined;
    base.user = parsed.username ?? undefined;
    base.password = parsed.password ?? undefined;
    base.database = parsed.database ?? undefined;
    for (const [key, value] of Object.entries(parsed.params)) {
      (base as Record<string, unknown>)[key] = value;
    }
  } else {
    base.host = cfg.host ?? undefined;
    base.port = cfg.port ?? undefined;
    base.user = cfg.username ?? undefined;
    base.password = cfg.password ?? undefined;
    base.database = cfg.database ?? undefined;
  }
  if (opts.database) base.database = opts.database;

  const sslmode = cfg.options.sslmode;
  if (typeof sslmode === 'string' && sslmode !== 'disable') {
    // verify-full deliberately uses the same `rejectUnauthorized: false` transport as
    // require/prefer, not `ssl: true` — see the comment on the post-connect check in
    // ConnectionSet.get() for why asking the driver's TLS layer itself to reject the handshake
    // is not safe to do here.
    if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-full') {
      base.ssl = { rejectUnauthorized: false };
    } else {
      opts.log('warn', `unknown sslmode "${sslmode}", ignoring`);
    }
  }

  opts.applyEngineOptions(base, cfg, opts.log);

  return base;
}

// Mirrors postgres/client.ts's ClientSet (D26): one Connection per (connection, database),
// never a pool, bounded at 8 with LRU eviction of non-primary connections. KILL QUERY needs a
// known threadId, which a pool does not reliably give you — the same reason Postgres avoids one.
export class ConnectionSet {
  private readonly connections = new Map<string, Connection>();
  private readonly lru: string[] = [];

  constructor(
    private readonly cfg: ResolvedConnectionConfig,
    private readonly log: AdapterDeps['log'],
    private readonly applyEngineOptions: MysqlFamilyProfile['applyEngineOptions'],
  ) {}

  async get(database: string | null): Promise<Connection> {
    const key = database ?? PRIMARY_KEY;
    const existing = this.connections.get(key);
    if (existing) {
      this.touch(key);
      return existing;
    }
    if (this.connections.size >= MAX_CONNECTIONS) {
      await this.evictLru();
    }
    const options = buildConnectionOptions(this.cfg, {
      database: database ?? undefined,
      log: this.log,
      applyEngineOptions: this.applyEngineOptions,
    });
    let connection: Connection;
    try {
      connection = await createConnection(options);
    } catch (err) {
      throw mapError(err);
    }
    // verify-full: buildConnectionOptions deliberately never asks the driver's TLS layer to
    // reject the handshake itself (rejectUnauthorized stays false even here). Checked against
    // mysql:8.4 and mariadb npm driver 3.5.3 (2026-08-25): when the socket layer *is* the one
    // rejecting a bad certificate, this driver races two of its own socket event handlers
    // against each other and reports whichever wins — sometimes the raw Node TLS validation
    // error, sometimes a generic ER_SOCKET_UNEXPECTED_CLOSE with no `.cause` back to the real
    // reason — and under Bun's test runner specifically, that failure has been observed to reach
    // the process as something no try/catch here (nor a bare `.rejects` on the caller's own
    // promise) ever intercepts, a known class of Bun TLS/socket bug (e.g. oven-sh/bun#7332).
    // Letting the handshake succeed and inspecting the driver's own post-handshake
    // `info.selfSignedCertificate`/`info.tlsAuthorizationError` (set unconditionally by
    // mariadb's handshake.js, never gated on rejectUnauthorized) avoids that failure path
    // entirely, at the cost of one extra round trip before the connection is torn back down.
    // Not in mariadb's own .d.ts (types/share.d.ts's ConnectionInfo), but set unconditionally by
    // lib/cmd/handshake/auth/handshake.js's post-TLS callback — present on every connection info
    // object at runtime, ssl or not.
    const info = connection.info as unknown as {
      selfSignedCertificate?: boolean;
      tlsAuthorizationError?: unknown;
    } | null;
    if (this.cfg.options.sslmode === 'verify-full' && info?.selfSignedCertificate) {
      const reason = info.tlsAuthorizationError;
      await connection.end().catch(() => {});
      throw new AdapterError(
        'E_AUTH',
        'TLS handshake failed: the server certificate could not be verified (sslmode=verify-full).',
        reason,
      );
    }
    this.connections.set(key, connection);
    this.touch(key);
    return connection;
  }

  primary(): Promise<Connection> {
    return this.get(null);
  }

  async closeAll(): Promise<void> {
    const all = [...this.connections.values()];
    this.connections.clear();
    this.lru.length = 0;
    await Promise.all(all.map((c) => c.end().catch(() => {})));
  }

  private touch(key: string): void {
    const idx = this.lru.indexOf(key);
    if (idx >= 0) this.lru.splice(idx, 1);
    this.lru.push(key);
  }

  private async evictLru(): Promise<void> {
    const victimKey = this.lru.find((key) => key !== PRIMARY_KEY);
    if (!victimKey) return;
    const victim = this.connections.get(victimKey);
    this.connections.delete(victimKey);
    const idx = this.lru.indexOf(victimKey);
    if (idx >= 0) this.lru.splice(idx, 1);
    if (victim) await victim.end().catch(() => {});
  }
}
