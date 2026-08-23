import { type Connection, createConnection } from 'mariadb';
import type { ConsoleRequest } from '../../../shared/domain/console';
import type { SourceText } from '../../../shared/domain/ddl';
import type { MutationPlan, MutationResult } from '../../../shared/domain/mutations';
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
import { mariadbCaps } from './caps';
import type { QueryExecutor } from './catalog';
import * as catalog from './catalog';
import { buildConnectionOptions, ConnectionSet } from './client';
import * as consoleQuery from './console';
import { buildDdl } from './ddl';
import * as mutate from './mutate';
import { type RunningQuery, runQuery, type TrackQuery } from './query';
import { countRows, readPage } from './read';

function safeThreadId(threadId: number): number {
  if (!Number.isSafeInteger(threadId)) throw new AdapterError('E_QUERY', 'invalid thread id');
  return threadId;
}

class MariaDbAdapter implements Adapter {
  readonly kind = 'mariadb' as const;
  readonly caps = mariadbCaps;

  private connectionSet: ConnectionSet | null = null;
  private cfg: ResolvedConnectionConfig | null = null;
  private primaryDatabase: string | null = null;
  private readonly runningByOp = new Map<string, RunningQuery>();
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const connectionSet = new ConnectionSet(cfg, this.deps.log);
    // P13 D1: assigned before anything is opened, not after the probe succeeds — the handle
    // must be reachable by disconnect() from the instant connectionSet.primary() could have
    // opened a socket, or a probe failure (or a dropped session mid-probe) leaks it (F1).
    this.connectionSet = connectionSet;
    this.cfg = cfg;
    try {
      const conn = await connectionSet.primary();
      const exec = this.execFor(conn, ctx);
      const rows = await exec<{ version: string; database: string | null; charset: string }>(
        'SELECT VERSION() AS version, DATABASE() AS `database`, @@character_set_server AS charset',
        [],
      );
      const row = rows[0];
      if (!row) throw new AdapterError('E_CONNECT', 'connect probe returned no rows');

      this.primaryDatabase = row.database ?? '';
      this.readOnly = cfg.readOnly;

      return {
        serverVersion: `MariaDB ${row.version}`,
        details: { database: row.database ?? '', charset: row.charset },
      };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.connectionSet?.closeAll();
    this.connectionSet = null;
    this.primaryDatabase = null;
    this.runningByOp.clear();
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const segments = path.segments;

    if (segments.length === 0) {
      const conn = await this.requireConnection(null);
      return catalog.listDatabases(this.execFor(conn, ctx), this.primaryDatabase ?? '');
    }

    const [databaseSegment, objectSegment] = segments;
    if (databaseSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment.kind}`,
      );
    }
    const conn = await this.requireConnection(databaseSegment.name);
    const exec = this.execFor(conn, ctx);

    if (segments.length === 1) {
      return catalog.listTablesAndRoutines(exec, databaseSegment.name);
    }
    if (!objectSegment) {
      throw new AdapterError('E_NOT_FOUND', 'missing path segment at depth 1');
    }

    if (segments.length === 2) {
      // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws.
      if (objectSegment.kind === 'sequence' || objectSegment.kind === 'function') return [];
      if (objectSegment.kind !== 'table' && objectSegment.kind !== 'view') {
        throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
      }
      return this.listColumnNodes(exec, segments, databaseSegment.name, objectSegment.name);
    }

    if (segments.length === 3) return []; // a column — leaf.

    throw new AdapterError('E_NOT_FOUND', `unrecognized path depth ${segments.length}`);
  }

  async describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      !databaseSegment ||
      databaseSegment.kind !== 'database' ||
      !objectSegment
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `describe requires a database/table path, got depth ${segments.length}`,
      );
    }

    const conn = await this.requireConnection(databaseSegment.name);
    const exec = this.execFor(conn, ctx);

    // Sequential, not Promise.all — mirrors postgres/index.ts's discipline of routing every
    // catalog query for one op through the same single connection.
    const rawColumns = await catalog.listColumns(exec, databaseSegment.name, objectSegment.name);
    const indexes = await catalog.listIndexes(exec, databaseSegment.name, objectSegment.name);
    const foreignKeys = await catalog.listForeignKeys(
      exec,
      databaseSegment.name,
      objectSegment.name,
    );
    const referencedBy = await catalog.listReferencedBy(
      exec,
      databaseSegment.name,
      objectSegment.name,
    );
    const primaryKey = catalog.primaryKeyFromIndexes(indexes);
    const pkColumns = new Set(primaryKey ?? []);
    const columns = rawColumns.map((col) => ({ ...col, isPrimaryKey: pkColumns.has(col.name) }));

    const infoRows = await exec<{ table_rows: string | number | null; comment: string | null }>(
      `SELECT TABLE_ROWS AS table_rows, TABLE_COMMENT AS comment
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [databaseSegment.name, objectSegment.name],
    );
    const info = infoRows[0];
    const rowEstimate = info?.table_rows == null ? null : Number(info.table_rows);

    return {
      path: encodePath(segments),
      kind: objectSegment.kind,
      name: objectSegment.name,
      qualifiedName: `${databaseSegment.name}.${objectSegment.name}`,
      columns,
      primaryKey,
      foreignKeys,
      referencedBy,
      indexes,
      rowEstimate,
      comment: info?.comment ? info.comment : null,
    };
  }

  async ddl(path: NodePath, ctx: OpCtx): Promise<SourceText> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      !databaseSegment ||
      databaseSegment.kind !== 'database' ||
      !objectSegment
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `ddl requires a database/table path, got depth ${segments.length}`,
      );
    }
    if (
      objectSegment.kind === 'sequence' ||
      objectSegment.kind === 'function' ||
      objectSegment.kind === 'column'
    ) {
      throw new AdapterError('E_UNSUPPORTED', `ddl is not supported for ${objectSegment.kind}`);
    }
    if (objectSegment.kind !== 'table' && objectSegment.kind !== 'view') {
      throw new AdapterError('E_UNSUPPORTED', `ddl is not supported for ${objectSegment.kind}`);
    }

    const conn = await this.requireConnection(databaseSegment.name);
    const exec = this.execFor(conn, ctx);
    return buildDdl(exec, segments, databaseSegment.name, {
      kind: objectSegment.kind,
      name: objectSegment.name,
    });
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { conn, target } = await this.resolveReadTarget(req.path, ctx);
    return readPage(conn, ctx, this.trackerFor(ctx.opId), target, {
      projection: req.projection,
      filter: req.filter,
      sort: req.sort,
      pageSize: req.pageSize,
      cursor: req.cursor,
    });
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    // P13 D13: count() never reads columns/PK/indexes off the target, so it resolves only the
    // qualified name — not the two catalog queries resolveReadTarget's full ReadTarget costs
    // (listColumns + listIndexes), which read() genuinely needs and still runs unchanged.
    const { conn, target } = await this.resolveCountTarget(req.path);
    return countRows(conn, ctx, this.trackerFor(ctx.opId), target, req.filter);
  }

  private async resolveReadTarget(
    path: NodePath,
    ctx: OpCtx,
  ): Promise<{ conn: Connection; target: catalog.ReadTarget }> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      !objectSegment ||
      (objectSegment.kind !== 'table' && objectSegment.kind !== 'view')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a database/table path, got: ${encodePath(segments)}`,
      );
    }
    const conn = await this.requireConnection(databaseSegment.name);
    const exec = this.execFor(conn, ctx);
    const target = await catalog.getReadTarget(exec, databaseSegment.name, objectSegment.name);
    return { conn, target };
  }

  // P13 D13: same path-shape validation as resolveReadTarget, no catalog round trip —
  // countRows' parameter type is `Pick<ReadTarget, 'qualifiedName'>`, so nothing else it could
  // return would ever be read.
  private async resolveCountTarget(
    path: NodePath,
  ): Promise<{ conn: Connection; target: Pick<catalog.ReadTarget, 'qualifiedName'> }> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      !objectSegment ||
      (objectSegment.kind !== 'table' && objectSegment.kind !== 'view')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `count requires a database/table path, got: ${encodePath(segments)}`,
      );
    }
    const conn = await this.requireConnection(databaseSegment.name);
    return {
      conn,
      target: { qualifiedName: { database: databaseSegment.name, table: objectSegment.name } },
    };
  }

  preview(plan: MutationPlan): string[] {
    return mutate.preview(plan);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    const [databaseSegment] = plan.path.segments;
    if (databaseSegment?.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment?.kind}`,
      );
    }
    const conn = await this.requireConnection(databaseSegment.name);
    return mutate.mutate(conn, ctx, this.trackerFor(ctx.opId), this.readOnly, plan);
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    const [databaseSegment] = req.path.segments;
    const conn = await this.requireConnection(
      databaseSegment?.kind === 'database' ? databaseSegment.name : null,
    );
    return consoleQuery.execute(conn, ctx, this.trackerFor(ctx.opId), req.statements);
  }

  async cancel(opId: string): Promise<boolean> {
    const running = this.runningByOp.get(opId);
    this.runningByOp.delete(opId);
    if (!running || !this.cfg || running.threadId === null) return false;

    // A short-lived side connection, mirroring Postgres's pg_cancel_backend path (D26). Killing
    // your own query needs no PROCESS/SUPER privilege — only killing someone else's does, which
    // is why the fixture can run the adapter as a non-root user (§6e).
    const options = buildConnectionOptions(this.cfg, { log: this.deps.log });
    let sideConn: Connection | null = null;
    try {
      sideConn = await createConnection(options);
      await sideConn.query(`KILL QUERY ${safeThreadId(running.threadId)}`);
      return true;
    } catch (err) {
      this.deps.log(
        'warn',
        `mariadb cancel(${opId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      await sideConn?.end().catch(() => {});
    }
  }

  private async listColumnNodes(
    exec: QueryExecutor,
    segments: NodePath['segments'],
    database: string,
    table: string,
  ): Promise<TreeNode[]> {
    const columns = await catalog.listColumns(exec, database, table);
    const indexes = await catalog.listIndexes(exec, database, table);
    const pkColumns = new Set(catalog.primaryKeyFromIndexes(indexes) ?? []);
    return columns.map((col) => ({
      kind: 'column' as const,
      name: col.name,
      path: encodePath([...segments, { kind: 'column', name: col.name }]),
      hasChildren: false,
      detail: col.nullable ? col.dataType : `${col.dataType} NOT NULL`,
      badges: pkColumns.has(col.name) ? ['PK'] : undefined,
    }));
  }

  private async requireConnection(database: string | null) {
    if (!this.connectionSet) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.connectionSet.get(database);
  }

  private execFor(conn: Connection, ctx: OpCtx): QueryExecutor {
    return (sql, params) => runQuery(conn, sql, params, ctx, this.trackerFor(ctx.opId));
  }

  // P13 D3: registers the running query and hands back its own release. The identity check in
  // the release closure is what makes a multi-statement op (mutate's transaction, console's
  // "Run all") correct — an earlier statement settling after a later one has started must not
  // unregister the later one, since both share this one opId.
  private trackerFor(opId: string): TrackQuery {
    return (q) => {
      this.runningByOp.set(opId, q);
      return () => {
        if (this.runningByOp.get(opId) === q) this.runningByOp.delete(opId);
      };
    };
  }
}

export function createMariaDbAdapter(deps: AdapterDeps): Adapter {
  return new MariaDbAdapter(deps);
}
