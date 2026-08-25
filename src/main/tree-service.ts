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
          if (parsed.success) return { nodes: parsed.data, source: 'cache' };
          await dropCached(db, connectionId, path);
        }
      }
      await requireConnected(connectionId);
      const nodePath = decodePath(connectionId, path);
      const result = await engineHost.call<{ nodes: TreeNode[] }>(ENGINE_OP.children, {
        connectionId,
        path: nodePath,
      });
      await putCached(db, connectionId, path, 'children', result.nodes);
      return { nodes: result.nodes, source: 'server' };
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
