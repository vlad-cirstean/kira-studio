import { Client } from 'pg';
import {
  encodePath,
  type NodePath,
  type ObjectMeta,
  type TreeNode,
} from '../../../shared/domain/tree';
import type { ResolvedConnectionConfig } from '../../../shared/protocol/engine-ops';
import type { Adapter, AdapterDeps, ConnectInfo, OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { postgresCaps } from './caps';
import type { QueryExecutor } from './catalog';
import * as catalog from './catalog';
import { buildClientConfig, ClientSet } from './client';
import { type RunningQuery, runQuery } from './query';

class PostgresAdapter implements Adapter {
  readonly kind = 'postgres' as const;
  readonly caps = postgresCaps;

  private clientSet: ClientSet | null = null;
  private cfg: ResolvedConnectionConfig | null = null;
  private primaryDatabase: string | null = null;
  private readonly runningByOp = new Map<string, RunningQuery>();
  // Recorded for a future write path — P1 issues no writes, so there is nothing to guard yet.
  // P5's mutate() is where this flag turns into an actual enforcement check.
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const clientSet = new ClientSet(cfg, this.deps.log);
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

    this.clientSet = clientSet;
    this.cfg = cfg;
    this.primaryDatabase = row.database;
    this.readOnly = cfg.readOnly;

    return {
      serverVersion: row.version,
      details: { database: row.database, encoding: row.encoding },
    };
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
      // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws.
      if (objectSegment.kind === 'sequence' || objectSegment.kind === 'function') return [];
      if (
        objectSegment.kind !== 'table' &&
        objectSegment.kind !== 'view' &&
        objectSegment.kind !== 'matview'
      ) {
        throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
      }
      return this.listColumnNodes(exec, segments, schemaSegment.name, objectSegment.name);
    }

    if (segments.length === 4) return []; // a column — leaf.

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

  private async listColumnNodes(
    exec: QueryExecutor,
    segments: NodePath['segments'],
    schema: string,
    table: string,
  ): Promise<TreeNode[]> {
    const oid = await catalog.getRelationOid(exec, schema, table);
    // Sequential — see the comment in describe() above.
    const columns = await catalog.listColumns(exec, schema, table);
    const indexes = await catalog.listIndexes(exec, oid);
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

  private async requireClient(database: string | null) {
    if (!this.clientSet) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.clientSet.get(database);
  }

  private execFor(client: Client, ctx: OpCtx): QueryExecutor {
    return (sql, params) =>
      runQuery(client, sql, params, ctx, (q) => this.runningByOp.set(ctx.opId, q));
  }
}

export function createPostgresAdapter(deps: AdapterDeps): Adapter {
  return new PostgresAdapter(deps);
}
