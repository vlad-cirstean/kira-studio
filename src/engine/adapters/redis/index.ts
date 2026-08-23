import type { ConsoleRequest } from '../../../shared/domain/console';
import type { SourceText } from '../../../shared/domain/ddl';
import type { MutationResult } from '../../../shared/domain/mutations';
import {
  encodePath,
  type NodePath,
  type ObjectMeta,
  type TreeNode,
} from '../../../shared/domain/tree';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { Page } from '../../../shared/protocol/page';
import type {
  Adapter,
  AdapterDeps,
  ConnectInfo,
  CountRequest,
  OpCtx,
  ReadRequest,
} from '../adapter';
import { AdapterError } from '../errors';
import { redisCaps } from './caps';
import * as catalog from './catalog';
import { connectRedis, type DbConnectionSet } from './client';
import * as consoleQuery from './console';
import { mapRedisError } from './errors';
import { countKey, readKey } from './read';

class RedisAdapter implements Adapter {
  readonly kind = 'redis' as const;
  readonly caps = redisCaps;

  private set: DbConnectionSet | null = null;
  private defaultDbIndex = 0;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const { set, defaultDbIndex } = await connectRedis(cfg, this.deps.log);
    let serverInfo: string;
    try {
      const primary = await set.primary();
      serverInfo = await primary.info('server');
    } catch (err) {
      await set.closeAll();
      throw mapRedisError(err);
    }

    this.set = set;
    this.defaultDbIndex = defaultDbIndex;
    const version = /redis_version:([^\r\n]+)/.exec(serverInfo)?.[1] ?? 'unknown';

    return {
      serverVersion: `Redis ${version}`,
      details: { database: `db${defaultDbIndex}` },
    };
  }

  async disconnect(): Promise<void> {
    await this.set?.closeAll();
    this.set = null;
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const segments = path.segments;
    if (segments.length === 0) return catalog.listDatabases(await this.requireSet().primary());

    const [dbSegment, ...rest] = segments;
    if (dbSegment.kind !== 'database') {
      throw new AdapterError('E_NOT_FOUND', `unexpected root path segment kind: ${dbSegment.kind}`);
    }
    // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws — a 'key'
    // node never has children.
    if (rest.length > 0 && rest[rest.length - 1].kind === 'key') return [];

    const namespaceSegments: string[] = [];
    for (const seg of rest) {
      if (seg.kind !== 'namespace') {
        throw new AdapterError('E_NOT_FOUND', `unexpected path segment kind: ${seg.kind}`);
      }
      namespaceSegments.push(seg.name);
    }

    const conn = await this.requireSet().get(catalog.dbIndexFromName(dbSegment.name));
    return catalog.listNamespaceChildren(conn, dbSegment.name, namespaceSegments, ctx);
  }

  async describe(): Promise<ObjectMeta> {
    // §8.8 has no FK/column navigation for Redis — describe() is only ever called from the
    // grid's own celleditor/state.ts (ground rules), never reached by a 'keyvalue' tab.
    throw new AdapterError('E_UNSUPPORTED', 'describe is not supported for redis');
  }

  async ddl(): Promise<SourceText> {
    // caps.ddl === false gates §8.10's "Open DDL" menu item for redis — never reached.
    throw new AdapterError('E_UNSUPPORTED', 'ddl is not supported for redis');
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { dbIndex, key } = this.resolveKeyTarget(req.path);
    const conn = await this.requireSet().get(dbIndex);
    return readKey(conn, key, req, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const { dbIndex, key } = this.resolveKeyTarget(req.path);
    const conn = await this.requireSet().get(dbIndex);
    return countKey(conn, key, ctx);
  }

  preview(): string[] {
    // caps.writable === false — the view is read-only in v1 (P9's D2); writes stay reachable
    // only through the console's raw commands.
    throw new AdapterError('E_UNSUPPORTED', 'redis connections are read-only in this version');
  }

  async mutate(): Promise<MutationResult> {
    throw new AdapterError('E_UNSUPPORTED', 'redis connections are read-only in this version');
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    const [dbSegment] = req.path.segments;
    const dbIndex =
      dbSegment?.kind === 'database'
        ? catalog.dbIndexFromName(dbSegment.name)
        : this.defaultDbIndex;
    return consoleQuery.execute(this.requireSet(), dbIndex, ctx, req.statements);
  }

  // D7/D8: `scheduler/ops.ts` aborts `ctx.signal` before calling `cancel()`, and every op this
  // adapter issues is either a bounded SCAN-family loop (checks the signal between rounds) or a
  // single fast command — the signal check is fully sufficient on its own, so this stays a
  // permanent no-op rather than attempting a `CLIENT KILL` that would be unsafe under
  // `DbConnectionSet`'s one-connection-per-db-index sharing (P9's D7).
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireSet(): DbConnectionSet {
    if (!this.set) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.set;
  }

  private resolveKeyTarget(path: NodePath): { dbIndex: number; key: string } {
    const segments = path.segments;
    const [dbSegment, ...rest] = segments;
    const keySegment = rest[rest.length - 1];
    if (dbSegment?.kind !== 'database' || keySegment?.kind !== 'key') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a database/.../key path, got: ${encodePath(segments)}`,
      );
    }
    return { dbIndex: catalog.dbIndexFromName(dbSegment.name), key: keySegment.name };
  }
}

export function createRedisAdapter(deps: AdapterDeps): Adapter {
  return new RedisAdapter(deps);
}
