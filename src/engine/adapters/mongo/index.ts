import type { ConsoleRequest } from '@shared/domain/console';
import type { ObjectDefinition } from '@shared/domain/definition';
import type { MutationPlan, MutationResult } from '@shared/domain/mutations';
import type { ObjectTransferResult } from '@shared/domain/object-store';
import { encodePath, type NodePath, type ObjectMeta } from '@shared/domain/tree';
import type { ResolvedConnectionConfig } from '@shared/protocol/engine-ops';
import type { Page } from '@shared/protocol/page';
import type { Db, MongoClient } from 'mongodb';
import type {
  Adapter,
  AdapterDeps,
  ConnectInfo,
  CountRequest,
  OpCtx,
  ReadRequest,
  TreeChildren,
} from '../adapter';
import { AdapterError, requireConnected, unsupported } from '../errors';
import { mongoCaps } from './caps';
import * as catalog from './catalog';
import { connectMongo } from './client';
import * as consoleQuery from './console';
import { buildDefinition } from './definition';
import { mapError } from './errors';
import * as mutate from './mutate';
import { countRows, readPage } from './read';

interface CurrentOpEntry {
  // Not necessarily a plain number (can be a compound shard-qualified value) — round-tripped to
  // killOp verbatim rather than assumed to be any particular type.
  opid?: unknown;
}

class MongoAdapter implements Adapter {
  readonly kind = 'mongodb' as const;
  readonly caps = mongoCaps;

  private client: MongoClient | null = null;
  private defaultDatabase: string | null = null;
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig): Promise<ConnectInfo> {
    const handle = await connectMongo(cfg, this.deps.log);
    let buildInfo: { version?: string };
    try {
      buildInfo = await handle.client.db().admin().buildInfo();
    } catch (err) {
      await handle.client.close().catch(() => {});
      throw mapError(err);
    }

    this.client = handle.client;
    this.defaultDatabase = handle.defaultDatabase;
    this.readOnly = cfg.readOnly;

    return {
      serverVersion: `MongoDB ${buildInfo.version ?? 'unknown'}`,
      details: this.defaultDatabase ? { database: this.defaultDatabase } : undefined,
    };
  }

  async disconnect(): Promise<void> {
    await this.client?.close().catch(() => {});
    this.client = null;
    this.defaultDatabase = null;
  }

  async children(path: NodePath): Promise<TreeChildren> {
    const segments = path.segments;
    if (segments.length === 0) return { nodes: await catalog.listDatabases(this.requireClient()) };

    const [databaseSegment, objectSegment] = segments;
    if (databaseSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment.kind}`,
      );
    }
    const db = this.dbFor(databaseSegment.name);

    if (segments.length === 1) return { nodes: await catalog.listCollections(db) };
    if (!objectSegment) throw new AdapterError('E_NOT_FOUND', 'missing path segment at depth 1');

    // Rule 5 (Adapter doc comment): children() returns [] for a leaf, never throws. P19 D5's own
    // SQL-relation precedent applies here too: a collection's indexes moved into the definition
    // view (describeIndexes(), still used by describe()), so a collection is a leaf like a table.
    if (segments.length === 2) {
      if (objectSegment.kind !== 'collection') {
        throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
      }
      return { nodes: [] };
    }

    throw new AdapterError('E_NOT_FOUND', `unrecognized path depth ${segments.length}`);
  }

  async describe(path: NodePath): Promise<ObjectMeta> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      objectSegment?.kind !== 'collection'
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `describe requires a database/collection path, got depth ${segments.length}`,
      );
    }

    // §8.5: "Mongo has no FK navigation in v1" — this stub satisfies the Adapter contract without
    // wiring detail no caller reaches; a document tab never calls describe() (ground rules).
    const db = this.dbFor(databaseSegment.name);
    const indexes = await catalog.describeIndexes(db, objectSegment.name);

    return {
      path: encodePath(segments),
      kind: 'collection',
      name: objectSegment.name,
      qualifiedName: `${databaseSegment.name}.${objectSegment.name}`,
      columns: [],
      primaryKey: null,
      foreignKeys: [],
      referencedBy: [],
      indexes: indexes.map((idx) => ({
        name: idx.name,
        columns: idx.columns,
        unique: idx.unique,
        primary: idx.name === '_id_',
        method: null,
      })),
      rowEstimate: null,
      comment: null,
    };
  }

  async definition(path: NodePath): Promise<ObjectDefinition> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      objectSegment?.kind !== 'collection'
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `definition requires a database/collection path, got depth ${segments.length}`,
      );
    }
    const db = this.dbFor(databaseSegment.name);
    return buildDefinition(db, segments, databaseSegment.name, objectSegment.name);
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const { db, collection } = this.resolveCollectionTarget(req.path);
    return readPage(db, collection, req, ctx);
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const { db, collection } = this.resolveCollectionTarget(req.path);
    return countRows(db, collection, req.filter, ctx);
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
    return mutate.mutate(this.dbFor(databaseSegment.name), ctx, this.readOnly, plan);
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    const [databaseSegment] = req.path.segments;
    const dbName =
      databaseSegment?.kind === 'database' ? databaseSegment.name : this.defaultDatabase;
    if (!dbName) throw new AdapterError('E_NOT_FOUND', 'no database selected for the console');
    return consoleQuery.execute(this.dbFor(dbName), ctx, req.statements);
  }

  // D7's fallback layer: `ctx.signal` (passed as every cursor op's native `signal` option) is
  // the primary cancel path; `$currentOp` + `killOp`, matched by the `comment: opId` tag every
  // op carries, covers a server-side op the client-side abort has already stopped waiting on but
  // that is still running. The legacy `currentOp` admin *command* requires the clusterMonitor-only
  // `inprog` privilege; the `$currentOp` aggregation *stage* with the default `allUsers: false`
  // returns only this connection's own in-flight ops and needs no special privilege — the common
  // case is an ordinary connection with plain readWrite on its own database, not an admin one.
  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for mongodb; never reached.
    unsupported(this.kind, 'file transfer');
  }

  async cancel(opId: string): Promise<boolean> {
    const client = this.client;
    if (!client) return false;
    try {
      const admin = client.db('admin');
      const ops = await admin
        .aggregate<CurrentOpEntry>([
          { $currentOp: { allUsers: false, idleConnections: false } },
          { $match: { 'command.comment': opId } },
        ])
        .toArray();
      let killed = false;
      for (const op of ops) {
        if (op.opid === undefined || op.opid === null) continue;
        await admin.command({ killOp: 1, op: op.opid });
        killed = true;
      }
      return killed;
    } catch (err) {
      this.deps.log(
        'warn',
        `mongodb cancel(${opId}) failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  private requireClient(): MongoClient {
    return requireConnected(this.client);
  }

  private dbFor(name: string): Db {
    return this.requireClient().db(name);
  }

  private resolveCollectionTarget(path: NodePath): { db: Db; collection: string } {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      databaseSegment?.kind !== 'database' ||
      objectSegment?.kind !== 'collection'
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `read requires a database/collection path, got: ${encodePath(segments)}`,
      );
    }
    return { db: this.dbFor(databaseSegment.name), collection: objectSegment.name };
  }
}

export function createMongoAdapter(deps: AdapterDeps): Adapter {
  return new MongoAdapter(deps);
}
