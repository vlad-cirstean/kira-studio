import type { Caps } from '@shared/caps';
import type { ConsoleRequest } from '@shared/domain/console';
import type { ObjectDefinition } from '@shared/domain/definition';
import type { MutationPlan, MutationResult } from '@shared/domain/mutations';
import type { ObjectTransferResult } from '@shared/domain/object-store';
import { encodePath, type NodePath, type ObjectMeta } from '@shared/domain/tree';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { Page } from '@shared/protocol/page';
import type {
  Adapter,
  AdapterDeps,
  ConnectInfo,
  CountRequest,
  OpCtx,
  ReadRequest,
  TreeChildren,
} from '../adapter';
import { AdapterError, unsupported } from '../errors';
import { clickhouseCaps } from './caps';
import type { QueryExecutor } from './catalog';
import * as catalog from './catalog';
import { type ClickHouseHandle, openClient } from './client';
import { execute as consoleExecute } from './console';
import { buildDefinition } from './definition';
import * as mutateFile from './mutate';
import { runCatalogQuery, type TrackQuery } from './query';
import { countRows, readPage } from './read';

const RELATION_KINDS = new Set(['table', 'view', 'matview']);

interface OpRuntime {
  h: ClickHouseHandle;
  exec: QueryExecutor;
  track: TrackQuery;
  nextQueryId: () => string;
}

class ClickHouseAdapter implements Adapter {
  readonly kind: Adapter['kind'] = 'clickhouse';
  readonly caps: Caps;

  private handle: ClickHouseHandle | null = null;
  private readOnly = false;
  // P13 D3's tracker shape, keyed on the op's own query_id (D8) rather than a thread id — this
  // adapter's KILL QUERY targets query_id, not a connection-level handle.
  private readonly runningByOp = new Map<string, string>();

  constructor(private readonly deps: AdapterDeps) {
    this.caps = clickhouseCaps;
  }

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const handle = await openClient(cfg, this.deps.log);
    // P13 D1: assigned before the probe runs, not after it succeeds — disconnect() must be able
    // to reach the handle from the instant openClient() returns, or a probe failure leaks it.
    this.handle = handle;
    this.readOnly = handle.readOnly;
    try {
      const { exec } = this.opRuntime(ctx);
      const rows = await exec<{ version: string; database: string; timezone: string }>(
        'SELECT version() AS version, currentDatabase() AS database, timezone() AS timezone',
      );
      const row = rows[0];
      if (!row) throw new AdapterError('E_CONNECT', 'connect probe returned no rows');
      return {
        serverVersion: `ClickHouse ${row.version}`,
        details: { url: handle.url, database: row.database, timezone: row.timezone },
      };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.handle?.client.close();
    } catch (err) {
      this.deps.log(
        'warn',
        `clickhouse disconnect: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.handle = null;
    this.runningByOp.clear();
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeChildren> {
    const { exec } = this.opRuntime(ctx);
    const segments = path.segments;

    if (segments.length === 0) {
      return { nodes: await catalog.listDatabases(exec) };
    }

    const [databaseSegment, objectSegment] = segments;
    if (databaseSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment.kind}`,
      );
    }

    if (segments.length === 1) {
      return { nodes: await catalog.listTablesAndViews(exec, databaseSegment.name) };
    }
    if (!objectSegment) {
      throw new AdapterError('E_NOT_FOUND', 'missing path segment at depth 1');
    }

    if (segments.length === 2) {
      // Adapter rule 5: children() returns [] for a leaf, never throws — a table/view/matview's
      // columns live in describe()/definition(), same as every other SQL adapter (P19 D5).
      if (RELATION_KINDS.has(objectSegment.kind)) return { nodes: [] };
      throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
    }

    throw new AdapterError('E_NOT_FOUND', `unrecognized path depth ${segments.length}`);
  }

  async describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta> {
    const { schema, name, kind } = this.requireRelationPath(path, 'describe');
    const { exec } = this.opRuntime(ctx);
    const target = await catalog.getReadTarget(exec, schema, name);
    // Sequential, not Promise.all — routes every catalog query for this op through the same
    // tracked query_id sequence, mirroring every other SQL adapter's own describe() discipline.
    const indexes = await catalog.listIndexes(exec, schema, name, target.primaryKeyExpression);

    return {
      path: encodePath(path.segments),
      kind,
      name,
      qualifiedName: `${schema}.${name}`,
      columns: target.columns,
      // D18: a MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint (F16) — never
      // claimed as an ObjectMeta.primaryKey, even though individual columns still carry their own
      // isPrimaryKey badge (catalog.toColumnMeta). ClickHouse has no foreign keys at all (F17).
      primaryKey: null,
      foreignKeys: [],
      referencedBy: [],
      indexes,
      rowEstimate: target.totalRows,
      comment: target.comment,
    };
  }

  async definition(path: NodePath, ctx: OpCtx): Promise<ObjectDefinition> {
    const { schema, name, kind } = this.requireRelationPath(path, 'definition');
    const { exec } = this.opRuntime(ctx);
    return buildDefinition(exec, path.segments, schema, { kind, name });
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { schema, name } = this.requireRelationPath(req.path, 'read');
    const { h, exec, track, nextQueryId } = this.opRuntime(ctx);
    const target = await catalog.getReadTarget(exec, schema, name);
    return readPage(
      h,
      ctx,
      target,
      {
        projection: req.projection,
        filter: req.filter,
        sort: req.sort,
        pageSize: req.pageSize,
        cursor: req.cursor,
      },
      track,
      nextQueryId,
    );
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    // No getReadTarget call (D19/scenario 30): count() needs only the qualified name, not the
    // columns/engine/keys catalog round trips read() genuinely uses.
    const { schema, name } = this.requireRelationPath(req.path, 'count');
    const { h, track, nextQueryId } = this.opRuntime(ctx);
    return countRows(
      h,
      ctx,
      { qualifiedName: { schema, table: name } },
      req.filter,
      track,
      nextQueryId,
    );
  }

  preview(plan: MutationPlan): string[] {
    return mutateFile.preview(plan);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    const { h, track, nextQueryId } = this.opRuntime(ctx);
    return mutateFile.mutate(h, ctx, track, this.readOnly, plan, nextQueryId);
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    const { h, track, nextQueryId } = this.opRuntime(ctx);
    return consoleExecute(h, ctx, track, req.statements, nextQueryId);
  }

  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for this engine; never reached.
    unsupported(this.kind, 'file transfer');
  }

  async cancel(opId: string): Promise<boolean> {
    const queryId = this.runningByOp.get(opId);
    this.runningByOp.delete(opId);
    if (!queryId || !this.handle) return false;

    // D7/D8: the KILL QUERY request never carries `readonly` — a second, free HTTP request on the
    // client's own connection pool (F7/F9), never scoped by this connection's own read-only flag.
    try {
      await this.handle.client.command({
        query: 'KILL QUERY WHERE query_id = {qid:String} SYNC',
        query_params: { qid: queryId },
      });
      return true;
    } catch (err) {
      this.deps.log(
        'warn',
        `clickhouse cancel(${opId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private requireRelationPath(
    path: NodePath,
    op: string,
  ): { schema: string; name: string; kind: 'table' | 'view' | 'matview' } {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      !objectSegment ||
      !RELATION_KINDS.has(objectSegment.kind)
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `${op} requires a database/table path, got: ${encodePath(segments)}`,
      );
    }
    return {
      schema: databaseSegment.name,
      name: objectSegment.name,
      kind: objectSegment.kind as 'table' | 'view' | 'matview',
    };
  }

  private requireHandle(): ClickHouseHandle {
    if (!this.handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.handle;
  }

  // D8's own refinement: a per-top-level-call closure rather than an instance-level Map, since
  // every top-level Adapter method call already gets a fresh, unique ctx.opId — nothing to clean
  // up or leak. Catalog queries never pass `database` (D19: every one is fully qualified).
  private opRuntime(ctx: OpCtx): OpRuntime {
    const h = this.requireHandle();
    let seq = 0;
    const nextQueryId = (): string => `kira-${ctx.opId}-${seq++}`;
    const track = this.trackerFor(ctx.opId);
    const exec: QueryExecutor = (sql, params) =>
      runCatalogQuery(h, ctx, sql, { queryId: nextQueryId() }, track, params);
    return { h, exec, track, nextQueryId };
  }

  // P13 D3: registers the running query_id and hands back its own release. The identity check in
  // the release closure is what makes a multi-statement op (mutate's insert, console's "Run all")
  // correct — an earlier statement settling after a later one has started must not unregister the
  // later one, since both share this one opId.
  private trackerFor(opId: string): TrackQuery {
    return (q) => {
      this.runningByOp.set(opId, q.queryId);
      return () => {
        if (this.runningByOp.get(opId) === q.queryId) this.runningByOp.delete(opId);
      };
    };
  }
}

export function createClickHouseAdapter(deps: AdapterDeps): Adapter {
  return new ClickHouseAdapter(deps);
}
