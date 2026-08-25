import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { ConnectionConfig } from 'mariadb';
import type { AdapterDeps } from '../adapter';

// P34 D3: stays `false` unless the connection's own options explicitly opt in. Retrieving the
// server's RSA public key over an unauthenticated connection is an MITM window (the client
// encrypts the password with a key it cannot verify) — which is why the driver defaults it off
// and why this is a per-connection choice, read from the same `cfg.options` channel `sslmode` is
// (mariadb/client.ts's own precedent), never a silent default (D5).
export function applyEngineOptions(
  base: ConnectionConfig,
  cfg: ResolvedConnectionConfig,
  _log: AdapterDeps['log'],
): void {
  if (cfg.options.allowPublicKeyRetrieval === 'true') {
    base.allowPublicKeyRetrieval = true;
  }
}

export { buildConnectionOptions, ConnectionSet } from '../mysql-family/client';
