import { parseConnectionUri } from '@shared/domain/uri';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { AdapterError } from '../errors';

// D6: one frozen handle per connection — no live connection, no pool, no keep-alive tuning
// (fetch's own agent already keeps connections alive, and every request here is small and
// independent). `baseUrl` never carries a path or userinfo, and `authorization` is the only place
// the password exists after this function returns — nothing downstream ever sees it again, which
// is what keeps a credential out of ctx.setCommand() text (F40, D6).
export interface RabbitHandle {
  readonly baseUrl: string;
  readonly authorization: string | null;
  /** D11: the connection's vhost scope, or null for "every vhost this user can see". */
  readonly vhostScope: string | null;
  readonly readOnly: boolean;
}

// D11/D12: fields mode carries the vhost as typed, but URI mode's parseConnectionUri does not
// decode percent-escapes out of the URL's pathname (shared/domain/uri.ts) — a pasted
// `rabbitmq://host:15672/%2F` (the management API's own documented default-vhost spelling, F8)
// would otherwise arrive as the literal three characters "%2F" rather than "/". Decoding here is
// idempotent for an already-plain name (decodeURIComponent of a string with no '%' is a no-op).
function resolveVhost(raw: string | null): string | null {
  if (raw === null || raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// D13: the same vocabulary and "warn, don't guess" handling as kafka/client.ts and P36 D12 —
// absent/'disable' speaks plain http, 'require'/'prefer'/'verify-full' speaks https with the
// system trust store. A custom CA or client certificate is out of scope (§6): fetch's TLS
// configuration is process-global in Node, so a per-connection override would be a cross-
// connection change, not a small addition here.
function resolveScheme(cfg: ResolvedConnectionConfig, log: AdapterDeps['log']): 'http' | 'https' {
  const sslmode = cfg.options.sslmode;
  if (typeof sslmode !== 'string' || sslmode === '' || sslmode === 'disable') return 'http';
  if (sslmode === 'require' || sslmode === 'prefer' || sslmode === 'verify-full') return 'https';
  log('warn', `unknown sslmode "${sslmode}", ignoring`);
  return 'http';
}

// D10-D13: builds the handle synchronously — no network call here. The one HTTP request that
// proves the handle actually works (GET /api/overview, D5) is issued by index.ts's connect(),
// through query.ts's request(), so its four distinguishable failures live in one place.
export function buildHandle(cfg: ResolvedConnectionConfig, log: AdapterDeps['log']): RabbitHandle {
  let host: string | null;
  let port: number | null;
  let vhostRaw: string | null;
  let username: string | null;
  let password: string | null;

  if (cfg.mode === 'uri' && cfg.uri) {
    const parsed = parseConnectionUri(cfg.uri);
    if (!parsed) throw new AdapterError('E_CONNECT', 'could not parse the connection URI');
    // D12: an amqp(s):// URI is the one a user actually has in their clipboard, and its port
    // (5672) is always wrong for this adapter — refused with the reason named, rather than
    // silently trying it or "helpfully" rewriting the port the user typed.
    if (parsed.scheme !== 'rabbitmq') {
      throw new AdapterError(
        'E_CONNECT',
        `this connection speaks the management API on 15672, not AMQP on 5672 — use ` +
          `rabbitmq://host:15672/vhost (got scheme "${parsed.scheme}:")`,
      );
    }
    host = parsed.host;
    port = parsed.port;
    vhostRaw = parsed.database;
    username = parsed.username;
    password = parsed.password;
  } else {
    host = cfg.host;
    port = cfg.port;
    vhostRaw = cfg.database;
    username = cfg.username;
    password = cfg.password;
  }

  if (!host) throw new AdapterError('E_CONNECT', 'no host was given');
  const scheme = resolveScheme(cfg, log);
  const baseUrl = `${scheme}://${host}:${port ?? 15672}`;

  // No default credentials guessed (mirrors every other adapter's `?? undefined` discipline) — an
  // empty username/password is sent as no Authorization header at all, and the server's own 401
  // (mapped to E_AUTH with its own reason, D5) speaks for itself rather than the app silently
  // trying "guest"/"guest" on the user's behalf.
  const authorization =
    username || password
      ? `Basic ${Buffer.from(`${username ?? ''}:${password ?? ''}`, 'utf8').toString('base64')}`
      : null;

  return {
    baseUrl,
    authorization,
    vhostScope: resolveVhost(vhostRaw),
    readOnly: cfg.readOnly,
  };
}
