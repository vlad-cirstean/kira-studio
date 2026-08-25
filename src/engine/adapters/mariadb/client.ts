import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { ConnectionConfig } from 'mariadb';
import type { AdapterDeps } from '../adapter';

// P34 D7/D9: MariaDB has no auth plugin that needs an engine-specific connection option — this is
// the MariaDB half of MysqlFamilyProfile.applyEngineOptions, a no-op. Compare
// mysql/client.ts's applyMysqlOptions, which reads allowPublicKeyRetrieval off cfg.options (D3).
export function applyEngineOptions(
  _base: ConnectionConfig,
  _cfg: ResolvedConnectionConfig,
  _log: AdapterDeps['log'],
): void {}

export { buildConnectionOptions, ConnectionSet } from '../mysql-family/client';
