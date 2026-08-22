import { z } from 'zod';
import { AdapterError } from '../engine/adapters/errors';
import { type SourceText, sourceTextSchema } from '../shared/ddl';
import { ENGINE_OP } from '../shared/engine-ops';
import { IPC } from '../shared/ipc';
import { type ObjectMeta, objectMetaSchema, type TreeNode, treeNodeSchema } from '../shared/tree';
import type { ConnectionsService } from './connections';
import type { EngineHost } from './engine-host';
import type { Db } from './storage/db';
import { dropCached, getCached, putCached } from './storage/metadata-cache';

// L1 cache-aside for children/describe/ddl (D10). SQLite is checked first and only a miss (or an
// explicit refresh) reaches the engine, so the tree renders from cache while disconnected and is
// instant on launch. A cached payload that fails validation is dropped and treated as a miss.

type Push = (channel: string, payload: unknown) => void;

export interface TreeService {
  children(
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ nodes: TreeNode[]; source: 'cache' | 'server' }>;
  describe(
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ meta: ObjectMeta; source: 'cache' | 'server' }>;
  ddl(
    connectionId: string,
    path: string,
    refresh?: boolean,
  ): Promise<{ ddl: SourceText; source: 'cache' | 'server' }>;
  invalidate(connectionId: string, path?: string): Promise<void>;
}

export function createTreeService(
  db: Db,
  engineHost: EngineHost,
  connections: ConnectionsService,
  push: Push,
): TreeService {
  async function requireConnected(connectionId: string): Promise<void> {
    const state = connections.getState(connectionId);
    if (state.status !== 'connected') {
      const name = (await connections.summary(connectionId))?.name ?? connectionId;
      throw new AdapterError('E_DISCONNECTED', `${name} is not connected`);
    }
  }

  async function children(
    connectionId: string,
    path: string,
    refresh = false,
  ): Promise<{ nodes: TreeNode[]; source: 'cache' | 'server' }> {
    if (!refresh) {
      const cached = await getCached(db, connectionId, path, 'children');
      if (cached !== null) {
        const parsed = z.array(treeNodeSchema).safeParse(cached);
        if (parsed.success) return { nodes: parsed.data, source: 'cache' };
        await dropCached(db, connectionId, path);
      }
    }
    await requireConnected(connectionId);
    const nodes = await engineHost.call<TreeNode[]>(ENGINE_OP.children, {
      connectionId,
      path,
      refresh,
    });
    const validated = z.array(treeNodeSchema).parse(nodes);
    await putCached(db, connectionId, path, 'children', validated);
    return { nodes: validated, source: 'server' };
  }

  async function describe(
    connectionId: string,
    path: string,
    refresh = false,
  ): Promise<{ meta: ObjectMeta; source: 'cache' | 'server' }> {
    if (!refresh) {
      const cached = await getCached(db, connectionId, path, 'describe');
      if (cached !== null) {
        const parsed = objectMetaSchema.safeParse(cached);
        if (parsed.success) return { meta: parsed.data, source: 'cache' };
        await dropCached(db, connectionId, path);
      }
    }
    await requireConnected(connectionId);
    const meta = await engineHost.call<ObjectMeta>(ENGINE_OP.describe, {
      connectionId,
      path,
      refresh,
    });
    const validated = objectMetaSchema.parse(meta);
    await putCached(db, connectionId, path, 'describe', validated);
    return { meta: validated, source: 'server' };
  }

  async function ddl(
    connectionId: string,
    path: string,
    refresh = false,
  ): Promise<{ ddl: SourceText; source: 'cache' | 'server' }> {
    if (!refresh) {
      const cached = await getCached(db, connectionId, path, 'ddl');
      if (cached !== null) {
        const parsed = sourceTextSchema.safeParse(cached);
        if (parsed.success) return { ddl: parsed.data, source: 'cache' };
        await dropCached(db, connectionId, path);
      }
    }
    await requireConnected(connectionId);
    const source = await engineHost.call<SourceText>(ENGINE_OP.ddl, {
      connectionId,
      path,
      refresh,
    });
    const validated = sourceTextSchema.parse(source);
    await putCached(db, connectionId, path, 'ddl', validated);
    return { ddl: validated, source: 'server' };
  }

  async function invalidate(connectionId: string, path?: string): Promise<void> {
    await dropCached(db, connectionId, path);
    push(IPC.connectionMetadataInvalidated, { connectionId, path });
  }

  return { children, describe, ddl, invalidate };
}
