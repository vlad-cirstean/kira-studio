import type { Caps } from '../../../shared/caps';
import type { ConnectionKind } from '../../../shared/connection';
import type { ConnectInfo, ResolvedConnectionConfig } from '../../../shared/engine-ops';
import { encodePath, type NodePath, type ObjectMeta, type TreeNode } from '../../../shared/tree';
import type { Adapter, AdapterDeps, OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import { postgresCaps } from './caps';
import * as catalog from './catalog';
import { buildClientConfig, ClientSet, cancelBackend } from './client';
import { type RunningQuery, runQuery, toAdapterError } from './query';

function relkindToKind(relkind: string): 'table' | 'view' | 'matview' | 'sequence' {
  switch (relkind) {
    case 'v':
      return 'view';
    case 'm':
      return 'matview';
    case 'S':
      return 'sequence';
    default:
      return 'table';
  }
}

function fkAction(code: string | null): string | null {
  switch (code) {
    case 'a':
      return 'NO ACTION';
    case 'r':
      return 'RESTRICT';
    case 'c':
      return 'CASCADE';
    case 'n':
      return 'SET NULL';
    case 'd':
      return 'SET DEFAULT';
    default:
      return null;
  }
}

export function createPostgresAdapter(deps: AdapterDeps): Adapter {
  return new PostgresAdapter(deps);
}

class PostgresAdapter implements Adapter {
  readonly kind: ConnectionKind = 'postgres';
  readonly caps: Caps = postgresCaps;

  private cfg: ResolvedConnectionConfig | null = null;
  private clients: ClientSet | null = null;
  private running = new Map<string, RunningQuery>();
  private currentDatabase: string | null = null;
  // readOnly is recorded here so P5's mutate() can enforce the guard engine-side; no P1 code path
  // issues a write, so there is nothing to guard yet.
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  private track = (ctx: OpCtx): ((q: RunningQuery) => void) => {
    return (q) => this.running.set(ctx.opId, q);
  };

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    this.cfg = cfg;
    this.readOnly = cfg.readOnly;
    this.clients = new ClientSet(cfg, (m) => this.deps.log('warn', m));
    try {
      const primary = await this.clients.primary();
      const rows = await runQuery<{ version: string; database: string; encoding: string }>(
        primary,
        "SELECT version() AS version, current_database() AS database, current_setting('server_encoding') AS encoding",
        [],
        ctx,
        this.track(ctx),
      );
      const info = rows[0];
      this.currentDatabase = info.database;
      return {
        serverVersion: info.version,
        details: { database: info.database, encoding: info.encoding },
      };
    } catch (err) {
      await this.clients.closeAll();
      throw toAdapterError(err);
    }
  }

  async disconnect(): Promise<void> {
    this.running.clear();
    if (this.clients) {
      await this.clients.closeAll();
      this.clients = null;
    }
    this.currentDatabase = null;
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const client = await this.clientFor(path);
    const track = this.track(ctx);
    const segs = path.segments;

    if (segs.length === 0) {
      const rows = await catalog.listDatabases(client, ctx, track);
      return rows.map((r) => ({
        kind: 'database' as const,
        name: r.name,
        path: encodePath([{ kind: 'database', name: r.name }]),
        hasChildren: true,
        detail: r.name === this.currentDatabase ? 'connected' : undefined,
      }));
    }

    const db = segs[0].name;
    if (segs.length === 1 && segs[0].kind === 'database') {
      const rows = await catalog.listSchemas(client, ctx, track);
      return rows.map((r) => ({
        kind: 'schema' as const,
        name: r.name,
        path: encodePath([
          { kind: 'database', name: db },
          { kind: 'schema', name: r.name },
        ]),
        hasChildren: true,
      }));
    }

    if (segs.length === 2 && segs[0].kind === 'database' && segs[1].kind === 'schema') {
      const schema = segs[1].name;
      const [rels, funcs] = await Promise.all([
        catalog.listRelations(client, schema, ctx, track),
        catalog.listFunctions(client, schema, ctx, track),
      ]);
      const relationNodes: TreeNode[] = rels.map((r) => {
        const kind = relkindToKind(r.relkind);
        return {
          kind,
          name: r.name,
          path: encodePath([
            { kind: 'database', name: db },
            { kind: 'schema', name: schema },
            { kind, name: r.name },
          ]),
          hasChildren: kind !== 'sequence',
          detail:
            (kind === 'table' || kind === 'matview') && r.rowEstimate !== null
              ? `~${r.rowEstimate} rows`
              : undefined,
        };
      });
      const functionNodes: TreeNode[] = funcs.map((f) => ({
        kind: 'function' as const,
        name: f.name,
        path: encodePath([
          { kind: 'database', name: db },
          { kind: 'schema', name: schema },
          { kind: 'function', name: f.name },
        ]),
        hasChildren: false,
        detail: `(${f.args})`,
      }));
      return [...relationNodes, ...functionNodes];
    }

    if (segs.length === 3 && segs[0].kind === 'database' && segs[1].kind === 'schema') {
      const schema = segs[1].name;
      const rel = segs[2].name;
      const info = await catalog.getRelationInfo(client, schema, rel, ctx, track);
      if (!info) return [];
      if (info.relkind === 'S') return []; // sequences are leaves (rule 5 in §4b)
      const [cols, indexes] = await Promise.all([
        catalog.listColumns(client, schema, rel, ctx, track),
        catalog.listIndexes(client, info.oid, ctx, track),
      ]);
      const pk = new Set(indexes.find((i) => i.primary)?.columns ?? []);
      return cols.map((c) => ({
        kind: 'column' as const,
        name: c.name,
        path: encodePath([
          { kind: 'database', name: db },
          { kind: 'schema', name: schema },
          { kind: relkindToKind(info.relkind), name: rel },
          { kind: 'column', name: c.name },
        ]),
        hasChildren: false,
        detail: c.dataType + (c.nullable ? '' : ' NOT NULL'),
        badges: pk.has(c.name) ? ['PK'] : undefined,
      }));
    }

    return [];
  }

  async describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta> {
    const segs = path.segments;
    if (segs.length !== 3 || segs[0].kind !== 'database' || segs[1].kind !== 'schema') {
      throw new AdapterError('E_NOT_FOUND', `cannot describe path ${encodePath(segs)}`);
    }
    const db = segs[0].name;
    const schema = segs[1].name;
    const rel = segs[2].name;
    const client = await this.clientFor(path);
    const track = this.track(ctx);

    const info = await catalog.getRelationInfo(client, schema, rel, ctx, track);
    if (!info) throw new AdapterError('E_NOT_FOUND', `relation ${schema}.${rel} not found`);

    const [cols, indexes, fks, inbound] = await Promise.all([
      catalog.listColumns(client, schema, rel, ctx, track),
      catalog.listIndexes(client, info.oid, ctx, track),
      catalog.listForeignKeys(client, info.oid, false, ctx, track),
      catalog.listForeignKeys(client, info.oid, true, ctx, track),
    ]);

    const pkIndex = indexes.find((i) => i.primary);
    const pkSet = new Set(pkIndex?.columns ?? []);
    const kind = relkindToKind(info.relkind);
    const base = [
      { kind: 'database' as const, name: db },
      { kind: 'schema' as const, name: schema },
      { kind, name: rel },
    ];
    const toFk = (f: catalog.ForeignKeyRow) => ({
      name: f.name,
      columns: f.columns,
      referencedPath: encodePath([
        { kind: 'database' as const, name: db },
        { kind: 'schema' as const, name: f.refSchema },
        { kind: 'table' as const, name: f.refTable },
      ]),
      referencedColumns: f.refColumns,
      onDelete: fkAction(f.onDelete),
      onUpdate: fkAction(f.onUpdate),
    });

    return {
      path: encodePath(base),
      kind,
      name: rel,
      qualifiedName: `${schema}.${rel}`,
      columns: cols.map((c) => ({
        name: c.name,
        position: c.position,
        dataType: c.dataType,
        nullable: c.nullable,
        defaultExpr: c.defaultExpr,
        isPrimaryKey: pkSet.has(c.name),
        comment: c.comment,
      })),
      primaryKey: pkIndex ? pkIndex.columns : null,
      foreignKeys: fks.map(toFk),
      referencedBy: inbound.map(toFk),
      indexes: indexes.map((i) => ({
        name: i.name,
        columns: i.columns,
        unique: i.unique,
        primary: i.primary,
        method: i.method,
      })),
      rowEstimate: info.rowEstimate,
      comment: info.comment,
    };
  }

  async cancel(opId: string): Promise<boolean> {
    const tracked = this.running.get(opId);
    if (!tracked || !this.cfg) return false;
    return cancelBackend(buildClientConfig(this.cfg), tracked.backendPid);
  }

  private async clientFor(path: NodePath): Promise<import('pg').Client> {
    if (!this.clients) throw new AdapterError('E_CONNECT', 'connection is not open');
    if (path.segments.length === 0) return this.clients.primary();
    return this.clients.get(path.segments[0].name);
  }
}
