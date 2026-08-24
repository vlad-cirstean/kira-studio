import { Client } from 'pg';
import type { ConsoleRequest } from '../../../shared/domain/console';
import type { ObjectDefinition } from '../../../shared/domain/definition';
import type { MutationPlan, MutationResult } from '../../../shared/domain/mutations';
import type { ObjectTransferResult } from '../../../shared/domain/object-store';
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
import { postgresCaps } from './caps';
import type { QueryExecutor } from './catalog';
import * as catalog from './catalog';
import { buildClientConfig, ClientSet } from './client';
import * as consoleQuery from './console';
import { buildDefinition } from './definition';
import * as mutate from './mutate';
import { type RunningQuery, runQuery, type TrackQuery } from './query';
import { countRows, readPage } from './read';

class PostgresAdapter implements Adapter {
  readonly kind = 'postgres' as const;
  readonly caps = postgresCaps;

  private clientSet: ClientSet | null = null;
  private cfg: ResolvedConnectionConfig | null = null;
  private primaryDatabase: string | null = null;
  private readonly runningByOp = new Map<string, RunningQuery>();
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const clientSet = new ClientSet(cfg, this.deps.log);
    // P13 D1: assigned before anything is opened, not after the probe succeeds — the handle
    // must be reachable by disconnect() from the instant clientSet.primary() could have opened a
    // socket, or a probe failure (or a dropped session mid-probe) leaks it (F1).
    this.clientSet = clientSet;
    this.cfg = cfg;
    try {
      const client = await clientSet.primary();
      const exec = this.execFor(client, ctx);
      const rows = await exec<{
        version: string;
        database: string;
        encoding: string;
      }>(
        `SELECT version() AS version, current_database() AS database,
                current_setting('server_encoding') AS encoding`,
        [],
      );
      const row = rows[0];
      if (!row) throw new AdapterError('E_CONNECT', 'connect probe returned no rows');

      this.primaryDatabase = row.database;
      this.readOnly = cfg.readOnly;

      return {
        serverVersion: row.version,
        details: { database: row.database, encoding: row.encoding },
      };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    await this.clientSet?.closeAll();
    this.clientSet = null;
    this.primaryDatabase = null;
    this.runningByOp.clear();
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const segments = path.segments;

    if (segments.length === 0) {
      const client = await this.requireClient(null);
      return catalog.listDatabases(this.execFor(client, ctx), this.primaryDatabase ?? '');
    }

    const [databaseSegment, schemaSegment, objectSegment] = segments;
    if (databaseSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment.kind}`,
      );
    }
    const client = await this.requireClient(databaseSegment.name);
    const exec = this.execFor(client, ctx);

    if (segments.length === 1) {
      return catalog.listSchemas(exec, databaseSegment.name);
    }
    if (schemaSegment?.kind !== 'schema') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected path segment kind at depth 1: ${schemaSegment?.kind}`,
      );
    }

    if (segments.length === 2) {
      return catalog.listRelationsAndFunctions(exec, databaseSegment.name, schemaSegment.name);
    }
    if (!objectSegment) {
      throw new AdapterError('E_NOT_FOUND', 'missing path segment at depth 2');
    }

    if (segments.length === 3) {
      // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws. P19 D5:
      // table/view/matview are leaves too now — their columns moved into the definition view,
      // and catalog.ts's own hasChildren: false for relations is what keeps the tree from ever
      // showing a twisty here in the first place.
      if (
        objectSegment.kind === 'sequence' ||
        objectSegment.kind === 'function' ||
        objectSegment.kind === 'table' ||
        objectSegment.kind === 'view' ||
        objectSegment.kind === 'matview'
      ) {
        return [];
      }
      throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
    }

    throw new AdapterError('E_NOT_FOUND', `unrecognized path depth ${segments.length}`);
  }

  async describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta> {
    const segments = path.segments;
    const [databaseSegment, schemaSegment, objectSegment] = segments;
    if (
      segments.length !== 3 ||
      !databaseSegment ||
      databaseSegment.kind !== 'database' ||
      !schemaSegment ||
      schemaSegment.kind !== 'schema' ||
      !objectSegment
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `describe requires a database/schema/table path, got depth ${segments.length}`,
      );
    }

    const client = await this.requireClient(databaseSegment.name);
    const exec = this.execFor(client, ctx);

    const info = await catalog.getRelationInfo(exec, schemaSegment.name, objectSegment.name);
    // Sequential, not Promise.all: `exec` routes every one of these through the same single
    // pg.Client (D14 — one Client per connection/database, never a Pool), and node-postgres has
    // deprecated firing concurrent queries at one Client (it silently queued them until now, but
    // that queuing is going away in pg@9).
    const rawColumns = await catalog.listColumns(exec, schemaSegment.name, objectSegment.name);
    const indexes = await catalog.listIndexes(exec, info.oid);
    const foreignKeys = await catalog.listForeignKeys(exec, info.oid, databaseSegment.name);
    const referencedBy = await catalog.listReferencedBy(exec, info.oid, databaseSegment.name);
    const primaryKey = catalog.primaryKeyFromIndexes(indexes);
    const pkColumns = new Set(primaryKey ?? []);
    const columns = rawColumns.map((col) => ({ ...col, isPrimaryKey: pkColumns.has(col.name) }));

    return {
      path: encodePath(segments),
      kind: objectSegment.kind,
      name: objectSegment.name,
      qualifiedName: `${schemaSegment.name}.${objectSegment.name}`,
      columns,
      primaryKey,
      foreignKeys,
      referencedBy,
      indexes,
      rowEstimate: info.rowEstimate,
      comment: info.comment,
    };
  }

  async definition(path: NodePath, ctx: OpCtx): Promise<ObjectDefinition> {
    const segments = path.segments;
    const [databaseSegment, schemaSegment, objectSegment] = segments;
    if (
      segments.length !== 3 ||
      !databaseSegment ||
      databaseSegment.kind !== 'database' ||
      !schemaSegment ||
      schemaSegment.kind !== 'schema' ||
      !objectSegment
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `definition requires a database/schema/table path, got depth ${segments.length}`,
      );
    }
    if (
      objectSegment.kind === 'sequence' ||
      objectSegment.kind === 'function' ||
      objectSegment.kind === 'column'
    ) {
      throw new AdapterError(
        'E_UNSUPPORTED',
        `definition is not supported for ${objectSegment.kind}`,
      );
    }
    if (
      objectSegment.kind !== 'table' &&
      objectSegment.kind !== 'view' &&
      objectSegment.kind !== 'matview'
    ) {
      throw new AdapterError(
        'E_UNSUPPORTED',
        `definition is not supported for ${objectSegment.kind}`,
      );
    }

    const client = await this.requireClient(databaseSegment.name);
    const exec = this.execFor(client, ctx);
    return buildDefinition(exec, segments, schemaSegment.name, {
      kind: objectSegment.kind,
      name: objectSegment.name,
    });
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { client, target } = await this.resolveReadTarget(req.path, ctx);
    return readPage(client, ctx, this.trackerFor(ctx.opId), target, {
      projection: req.projection,
      filter: req.filter,
      sort: req.sort,
      pageSize: req.pageSize,
      cursor: req.cursor,
    });
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    // P13 D13: count() never reads columns/PK/indexes/oid off the target, so it resolves only
    // the qualified name — not the three catalog queries resolveReadTarget's full ReadTarget
    // costs (getRelationInfo + listColumns + listIndexes), which read() genuinely needs and
    // still runs unchanged.
    const { client, target } = await this.resolveCountTarget(req.path);
    return countRows(client, ctx, this.trackerFor(ctx.opId), target, req.filter);
  }

  private async resolveReadTarget(
    path: NodePath,
    ctx: OpCtx,
  ): Promise<{ client: Client; target: catalog.ReadTarget }> {
    const segments = path.segments;
    const [databaseSegment, schemaSegment, objectSegment] = segments;
    if (
      segments.length !== 3 ||
      databaseSegment?.kind !== 'database' ||
      schemaSegment?.kind !== 'schema' ||
      !objectSegment ||
      (objectSegment.kind !== 'table' &&
        objectSegment.kind !== 'view' &&
        objectSegment.kind !== 'matview')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a database/schema/table path, got: ${encodePath(segments)}`,
      );
    }
    const client = await this.requireClient(databaseSegment.name);
    const exec = this.execFor(client, ctx);
    const target = await catalog.getReadTarget(exec, schemaSegment.name, objectSegment.name);
    return { client, target };
  }

  // P13 D13: same path-shape validation as resolveReadTarget, no catalog round trip — countRows'
  // parameter type is `Pick<ReadTarget, 'qualifiedName'>`, so nothing else it could return would
  // ever be read.
  private async resolveCountTarget(
    path: NodePath,
  ): Promise<{ client: Client; target: Pick<catalog.ReadTarget, 'qualifiedName'> }> {
    const segments = path.segments;
    const [databaseSegment, schemaSegment, objectSegment] = segments;
    if (
      segments.length !== 3 ||
      databaseSegment?.kind !== 'database' ||
      schemaSegment?.kind !== 'schema' ||
      !objectSegment ||
      (objectSegment.kind !== 'table' &&
        objectSegment.kind !== 'view' &&
        objectSegment.kind !== 'matview')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `count requires a database/schema/table path, got: ${encodePath(segments)}`,
      );
    }
    const client = await this.requireClient(databaseSegment.name);
    return {
      client,
      target: { qualifiedName: { schema: schemaSegment.name, relation: objectSegment.name } },
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
    const client = await this.requireClient(databaseSegment.name);
    return mutate.mutate(client, ctx, this.trackerFor(ctx.opId), this.readOnly, plan);
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    const [databaseSegment] = req.path.segments;
    const client = await this.requireClient(
      databaseSegment?.kind === 'database' ? databaseSegment.name : null,
    );
    return consoleQuery.execute(client, ctx, this.trackerFor(ctx.opId), req.statements);
  }

  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for postgres; never reached.
    throw new AdapterError('E_UNSUPPORTED', 'file transfer is not supported for postgres');
  }

  async cancel(opId: string): Promise<boolean> {
    const running = this.runningByOp.get(opId);
    this.runningByOp.delete(opId);
    if (!running || !this.cfg) return false;

    const sideClient = new Client(buildClientConfig(this.cfg, { log: this.deps.log }));
    try {
      await sideClient.connect();
      const result = await sideClient.query<{ pg_cancel_backend: boolean }>(
        'SELECT pg_cancel_backend($1) AS pg_cancel_backend',
        [running.backendPid],
      );
      return result.rows[0]?.pg_cancel_backend ?? false;
    } catch (err) {
      this.deps.log(
        'warn',
        `postgres cancel(${opId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    } finally {
      await sideClient.end().catch(() => {});
    }
  }

  private async requireClient(database: string | null) {
    if (!this.clientSet) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.clientSet.get(database);
  }

  private execFor(client: Client, ctx: OpCtx): QueryExecutor {
    return (sql, params) => runQuery(client, sql, params, ctx, this.trackerFor(ctx.opId));
  }

  // P13 D3: registers the running query and hands back its own release. The identity check in
  // the release closure is what makes a multi-statement op (mutate's BEGIN/…/COMMIT, console's
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

export function createPostgresAdapter(deps: AdapterDeps): Adapter {
  return new PostgresAdapter(deps);
}
