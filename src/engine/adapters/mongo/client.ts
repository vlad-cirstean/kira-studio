import { MongoClient } from 'mongodb';
import { parseConnectionUri } from '../../../shared/domain/uri';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { AdapterDeps } from '../adapter';
import { mapError } from './errors';

const CONNECT_TIMEOUT_MS = 10_000;

export interface MongoClientHandle {
  client: MongoClient;
  /** The database named by the connection's own config, if any — the console's fallback target. */
  defaultDatabase: string | null;
}

// D8: one pooled MongoClient per adapter instance — the driver's own internal pool handles
// concurrency, so there is no ConnectionSet/LRU analog to MariaDB's (client.db(name) is a cheap
// synchronous handle-get, not a new connection).
export async function connectMongo(
  cfg: ResolvedConnectionConfig,
  log: AdapterDeps['log'],
): Promise<MongoClientHandle> {
  // The connection dialog's formatConnectionUri() already spells the mongodb scheme literally
  // for kind === 'mongodb' (uri.ts), and main re-injects the password before this ever runs
  // (engine-ops.ts's ResolvedConnectionConfig doc comment) — the URI is driver-ready as-is.
  const uri = cfg.mode === 'uri' && cfg.uri ? cfg.uri : buildUriFromFields(cfg);

  const sslmode = cfg.options.sslmode;
  const tlsOptions: { tls?: boolean; tlsAllowInvalidCertificates?: boolean } = {};
  if (typeof sslmode === 'string' && sslmode !== 'disable') {
    if (sslmode === 'require' || sslmode === 'prefer') {
      tlsOptions.tls = true;
      tlsOptions.tlsAllowInvalidCertificates = true;
    } else if (sslmode === 'verify-full') {
      tlsOptions.tls = true;
    } else {
      log('warn', `mongodb: unknown sslmode "${sslmode}", ignoring`);
    }
  }

  const client = new MongoClient(uri, {
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS,
    driverInfo: { name: 'kira-studio' },
    ...tlsOptions,
  });

  try {
    await client.connect();
  } catch (err) {
    await client.close().catch(() => {});
    throw mapError(err);
  }

  const defaultDatabase =
    cfg.mode === 'uri' && cfg.uri
      ? (parseConnectionUri(cfg.uri)?.database ?? null)
      : (cfg.database ?? null);

  return { client, defaultDatabase };
}

function buildUriFromFields(cfg: ResolvedConnectionConfig): string {
  const host = cfg.host ?? 'localhost';
  const port = cfg.port ?? 27017;
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}${cfg.password ? `:${encodeURIComponent(cfg.password)}` : ''}@`
    : '';
  const db = cfg.database ? `/${encodeURIComponent(cfg.database)}` : '/';
  return `mongodb://${auth}${host}:${port}${db}`;
}
