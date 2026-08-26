import { type ObjectDefinition, objectDefinitionSchema } from '@shared/domain/definition';
import {
  decodePath,
  type ObjectMeta,
  objectMetaSchema,
  type TreeNode,
  treeNodeSchema,
} from '@shared/domain/tree';
import { ENGINE_OP } from '@shared/protocol/engine-ops';
import { z } from 'zod';
import type { ConnectionsService } from './connections';
import type { EngineHost } from './engine-host';
import type { KiraDb } from './storage/db';
import { getConnection } from './storage/repos/connections';
import { dropCached, getCached, putCached } from './storage/repos/metadata-cache';

export class DisconnectedError extends Error {
  readonly code = 'E_DISCONNECTED';
}

export interface TreeChildrenResult {
  nodes: TreeNode[];
  source: 'cache' | 'server';
  /** P43 iter2 D21/D22: never persisted — a truncated level is never written to metadata_cache,
   *  and P43 iter3 D38 also drops any older, complete-looking row a truncated refresh could not
   *  replace (below) — so a `source: 'cache'` result is always complete and this is always
   *  `false`. */
  truncated: boolean;
}

export interface TreeDescribeResult {
  meta: ObjectMeta;
  source: 'cache' | 'server';
}

export interface TreeDefinitionResult {
  definition: ObjectDefinition;
  source: 'cache' | 'server';
}

export interface TreeService {
  children(connectionId: string, path: string, refresh: boolean): Promise<TreeChildrenResult>;
  // `tabId` tags the resulting op-log row so the requesting tab's RunState can find its own
  // duration (state/runState.ts) — a cache hit makes no engine call and so tags nothing, which
  // is correct: there is no duration to show for work that never happened.
  describe(
    connectionId: string,
    path: string,
    refresh: boolean,
    tabId?: string | null,
  ): Promise<TreeDescribeResult>;
  definition(
    connectionId: string,
    path: string,
    refresh: boolean,
    tabId?: string | null,
  ): Promise<TreeDefinitionResult>;
  /** Drops L1 for one node (path given) or the whole connection (path omitted). No push of its
   * own — the caller already knows what it asked to invalidate. The D11 reconnect push is
   * `connections.onMetadataInvalidated`, a separate concern owned by connections.ts. */
  invalidate(connectionId: string, path?: string): Promise<void>;
}

const treeNodeArraySchema = z.array(treeNodeSchema);

// L1 cache-aside for children()/describe() (D10). `path` is always the encoded string form —
// it is exactly what's persisted in metadata_cache.path, so no re-encoding happens on this side.
export function createTreeService(
  db: KiraDb,
  engineHost: EngineHost,
  connections: ConnectionsService,
): TreeService {
  async function requireConnected(connectionId: string): Promise<void> {
    const state = connections.stateOf(connectionId);
    if (state.status !== 'connected') {
      const summary = await getConnection(db, connectionId);
      throw new DisconnectedError(`${summary?.name ?? connectionId} is not connected`);
    }
  }

  return {
    async children(connectionId, path, refresh) {
      if (!refresh) {
        const cached = await getCached(db, connectionId, path, 'children');
        if (cached !== null) {
          const parsed = treeNodeArraySchema.safeParse(cached);
          if (parsed.success) return { nodes: parsed.data, source: 'cache', truncated: false };
          await dropCached(db, connectionId, path);
        }
      }
      await requireConnected(connectionId);
      const nodePath = decodePath(connectionId, path);
      const result = await engineHost.call<{ nodes: TreeNode[]; truncated?: boolean }>(
        ENGINE_OP.children,
        { connectionId, path: nodePath },
      );
      // P43 iter2 D22: a truncated listing is a different, smaller answer than the real one — not
      // caching it means the next visit re-scans (and may well succeed) instead of serving the
      // same short list, possibly past an app restart, until the user happens to press Refresh.
      // P43 iter3 D38/F38: a truncated *refresh* still has to answer for whatever complete listing
      // is already sitting in the row from an earlier, smaller visit — leaving it would serve that
      // stale answer back as `source: 'cache', truncated: false` on the very next ordinary load,
      // which is D22's own guarantee broken one step later. Dropping is the same "cannot be
      // trusted" call this function already makes on a schema-mismatched cache read, above.
      if (!result.truncated) await putCached(db, connectionId, path, 'children', result.nodes);
      else await dropCached(db, connectionId, path);
      return { nodes: result.nodes, source: 'server', truncated: !!result.truncated };
    },

    async describe(connectionId, path, refresh, tabId = null) {
      if (!refresh) {
        const cached = await getCached(db, connectionId, path, 'describe');
        if (cached !== null) {
          const parsed = objectMetaSchema.safeParse(cached);
          if (parsed.success) return { meta: parsed.data, source: 'cache' };
          await dropCached(db, connectionId, path);
        }
      }
      await requireConnected(connectionId);
      const nodePath = decodePath(connectionId, path);
      const result = await engineHost.call<{ meta: ObjectMeta }>(ENGINE_OP.describe, {
        connectionId,
        path: nodePath,
        tabId,
      });
      await putCached(db, connectionId, path, 'describe', result.meta);
      return { meta: result.meta, source: 'server' };
    },

    async definition(connectionId, path, refresh, tabId = null) {
      if (!refresh) {
        const cached = await getCached(db, connectionId, path, 'definition');
        if (cached !== null) {
          const parsed = objectDefinitionSchema.safeParse(cached);
          if (parsed.success) return { definition: parsed.data, source: 'cache' };
          await dropCached(db, connectionId, path);
        }
      }
      await requireConnected(connectionId);
      const nodePath = decodePath(connectionId, path);
      const result = await engineHost.call<{ definition: ObjectDefinition }>(ENGINE_OP.definition, {
        connectionId,
        path: nodePath,
        tabId,
      });
      await putCached(db, connectionId, path, 'definition', result.definition);
      return { definition: result.definition, source: 'server' };
    },

    invalidate(connectionId, path) {
      return dropCached(db, connectionId, path);
    },
  };
}
