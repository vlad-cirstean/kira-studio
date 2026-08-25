import type { ConnectionKind } from '@shared/domain/connection';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { ConnectionConfig } from 'mariadb';
import type { AdapterDeps } from '../adapter';

// P34 D7/D9: everything that genuinely differs between a MariaDB connection and a MySQL one, and
// nothing else. Three fields, deliberately — the sequence branches in catalog.ts stay shared and
// unconditional (D9) because a MySQL server can never produce a 'SEQUENCE' TABLE_TYPE row, so a
// fourth "hasSequences" field would add a decision point to the code and remove nothing from the
// output. A profile field must change observable behaviour, or it does not exist.
export interface MysqlFamilyProfile {
  /** The adapter's own kind, surfaced as `Adapter.kind` and used in log lines. */
  readonly kind: Extract<ConnectionKind, 'mariadb' | 'mysql'>;
  /** Prefix for ConnectInfo.serverVersion: 'MariaDB' / 'MySQL' (D6). */
  readonly serverLabel: string;
  /**
   * Engine-specific connection options, applied after the shared host/port/user/ssl handling.
   * MariaDB's is a no-op; MySQL's reads `allowPublicKeyRetrieval` off `cfg.options` (D3).
   */
  applyEngineOptions(
    base: ConnectionConfig,
    cfg: ResolvedConnectionConfig,
    log: AdapterDeps['log'],
  ): void;
}
