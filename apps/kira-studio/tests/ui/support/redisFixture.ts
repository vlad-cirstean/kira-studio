import type { ConnectionSummary } from '@shared/domain/connection';
import type { ControlSnapshot } from '../../ipc/support/types';
import { IPC } from './ipcChannels';

// Real capture of a real Redis 7 container's connect() response — via
// `bun scripts/capture-tree.ts redis --recipe-file ...` (scripts/capture-tree.ts), not
// hand-written (P50 D5). Confirmed here, a real environment finding: unlike Postgres (AGENTS.md's
// Docker section), Redis's container starts and this capture completes fine under plain
// `bun run` too — no esbuild/vendored-Node workaround needed for this adapter.
//
// Nothing beyond `connect` is needed: autocomplete.spec.ts's two Redis scenarios (command-name
// completion, lint diagnostics) exercise `console/completion.ts`'s `redisCompletionSource()` and
// `console/lint.ts`'s redis tokenizer, both pure client-side vocabulary/grammar with no backend
// round trip at all (see src/renderer/views/console/completion.ts's own `REDIS_COMMANDS` — a
// curated constant, not fetched) — and neither scenario ever expands the tree (both open the
// console straight from the connection root).

const SERVER_VERSION = 'Redis 7.4.11';

const CAPS = {
  tabular: false,
  documents: false,
  keyValue: true,
  stream: false,
  keyBrowser: true,
  defaultPageKind: 'keyvalue' as const,
  sql: true,
  definition: false,
  describe: false,
  projection: false,
  serverFilter: false,
  exactCount: true,
  pagination: 'cursor' as const,
  foreignKeys: false,
  canInsert: true,
  canUpdate: true,
  canDelete: true,
  writable: true,
  transactions: false,
  cancel: true,
  fileTransfer: false,
};

export function connectControl(connectionId: string): ControlSnapshot[] {
  return [
    {
      channel: IPC.connectionsConnect,
      args: { id: connectionId },
      response: {
        connectionId,
        status: 'connected',
        serverVersion: SERVER_VERSION,
        error: null,
        since: 1735689600000,
        caps: CAPS,
      },
    },
  ];
}

export function redisConnectionSummary(
  id: string,
  name: string,
  color: ConnectionSummary['color'],
): ConnectionSummary {
  return {
    id,
    name,
    kind: 'redis',
    color,
    mode: 'fields',
    readOnly: false,
    host: '127.0.0.1',
    port: 6379,
    database: '0',
    username: null,
    uri: null,
    options: {},
    preconnect: null,
    preconnectSidecar: false,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}
