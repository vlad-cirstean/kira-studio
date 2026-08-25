import type { Caps } from '../../../shared/caps';
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
import { AdapterError, unsupported } from '../errors';
import { sqliteCaps } from './caps';
import * as catalog from './catalog';
import { openDatabase, type SqliteHandle } from './client';
import { execute as executeConsole } from './console';
import { buildDefinition } from './definition';
import * as mutateModule from './mutate';
import { runQuery } from './query';
import { countRows, quoteIdent, readPage } from './read';

// P35 D17/D18: stands alone — no "family" pattern (that exists in mysql-family/ because two
// engines share one wire protocol and one driver, P34 D7). SQLite shares neither with anything.
class SqliteAdapter implements Adapter {
  readonly kind: Adapter['kind'] = 'sqlite';
  readonly caps: Caps = sqliteCaps;

  private handle: SqliteHandle | null = null;
  private readOnly = false;

  constructor(private readonly deps: AdapterDeps) {}

  async connect(cfg: ResolvedConnectionConfig, ctx: OpCtx): Promise<ConnectInfo> {
    const handle = await openDatabase(cfg);
    this.handle = handle;
    this.readOnly = cfg.readOnly;
    try {
      const exec = this.execFor(ctx);
      // The file-format check is lazy, not eager (verified against node:sqlite directly: opening
      // a garbage file succeeds silently and only fails on first real statement) — this probe is
      // what makes a bad-format file surface as E_CONNECT during connect(), not later on the
      // first tree expansion.
      const [row] = exec<{ version: string }>('SELECT sqlite_version() AS version', []);
      if (!row) throw new AdapterError('E_CONNECT', 'connect probe returned no rows');

      // D6: read-only pragma reads for the connection tooltip — never written by this adapter.
      const [journalRow] = exec<{ journal_mode: string }>('PRAGMA journal_mode', []);
      const [pageRow] = exec<{ page_size: number | bigint }>('PRAGMA page_size', []);

      return {
        serverVersion: `SQLite ${row.version}`,
        details: {
          file: handle.file,
          journalMode: journalRow?.journal_mode ?? '',
          pageSize: pageRow ? String(pageRow.page_size) : '',
        },
      };
    } catch (err) {
      await this.disconnect();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.handle) {
      try {
        this.handle.db.close();
      } catch (err) {
        this.deps.log(
          'warn',
          `sqlite disconnect: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.handle = null;
  }

  async children(path: NodePath, ctx: OpCtx): Promise<TreeNode[]> {
    const segments = path.segments;
    const exec = this.execFor(ctx);

    if (segments.length === 0) {
      return catalog.listDatabases(exec);
    }

    const [databaseSegment, objectSegment] = segments;
    if (databaseSegment.kind !== 'database') {
      throw new AdapterError(
        'E_NOT_FOUND',
        `unexpected root path segment kind: ${databaseSegment.kind}`,
      );
    }
    if (segments.length === 1) {
      return catalog.listTablesAndViews(exec, databaseSegment.name);
    }
    if (!objectSegment) {
      throw new AdapterError('E_NOT_FOUND', 'missing path segment at depth 1');
    }
    if (segments.length === 2) {
      // Rule 5 (Adapter doc comment): every relation is a leaf (P19 D5) — its columns live in
      // the definition view, not the tree.
      if (objectSegment.kind === 'table' || objectSegment.kind === 'view') return [];
      throw new AdapterError('E_NOT_FOUND', `unexpected object kind: ${objectSegment.kind}`);
    }

    throw new AdapterError('E_NOT_FOUND', `unrecognized path depth ${segments.length}`);
  }

  async describe(path: NodePath, ctx: OpCtx): Promise<ObjectMeta> {
    const segments = path.segments;
    const [databaseSegment, objectSegment] = segments;
    if (
      segments.length !== 2 ||
      !databaseSegment ||
      databaseSegment.kind !== 'database' ||
      !objectSegment ||
      (objectSegment.kind !== 'table' && objectSegment.kind !== 'view')
    ) {
      throw new AdapterError(
        'E_NOT_FOUND',
        `describe requires a database/table path, got depth ${segments.length}`,
      );
    }

    const exec = this.execFor(ctx);
    const target = catalog.getReadTarget(exec, databaseSegment.name, objectSegment.name);
    const indexes = catalog.listIndexes(exec, objectSegment.name);
    const foreignKeys = catalog.listForeignKeys(exec, databaseSegment.name, objectSegment.name);
    const allTables = catalog.listAllTableNames(exec, databaseSegment.name);
    const referencedBy = catalog.listReferencedBy(
      exec,
      databaseSegment.name,
      objectSegment.name,
      allTables,
    );
    const rowEstimate =
      objectSegment.kind === 'table' ? catalog.getRowEstimateFor(exec, objectSegment.name) : null;

    return {
      path: encodePath(segments),
      kind: objectSegment.kind,
      name: objectSegment.name,
      qualifiedName: `${databaseSegment.name}.${objectSegment.name}`,
      columns: target.columns,
      primaryKey: target.primaryKey,
      foreignKeys,
      referencedBy,
      indexes,
      rowEstimate,
      comment: null, // SQLite has no column/table comment concept
    };
  }

  async definition(path: NodePath, ctx: OpCtx): Promise<ObjectDefinition> {
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
        `definition requires a database/table path, got depth ${segments.length}`,
      );
    }
    if (objectSegment.kind !== 'table' && objectSegment.kind !== 'view') {
      throw new AdapterError(
        'E_UNSUPPORTED',
        `definition is not supported for ${objectSegment.kind}`,
      );
    }

    const exec = this.execFor(ctx);
    return buildDefinition(exec, segments, databaseSegment.name, {
      kind: objectSegment.kind,
      name: objectSegment.name,
    });
  }

  async read(req: ReadRequest, ctx: OpCtx): Promise<Page> {
    const target = this.resolveReadTarget(req.path, ctx);
    return readPage(this.requireHandle(), ctx, target, {
      projection: req.projection,
      filter: req.filter,
      sort: req.sort,
      pageSize: req.pageSize,
      cursor: req.cursor,
    });
  }

  async count(req: CountRequest, ctx: OpCtx): Promise<{ value: number; exact: boolean }> {
    const segments = req.path.segments;
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
    return countRows(
      this.requireHandle(),
      ctx,
      { qualifiedName: { schema: databaseSegment.name, table: objectSegment.name } },
      req.filter,
    );
  }

  private resolveReadTarget(path: NodePath, ctx: OpCtx): catalog.ReadTarget {
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
    const exec = this.execFor(ctx);
    return catalog.getReadTarget(exec, databaseSegment.name, objectSegment.name);
  }

  preview(plan: MutationPlan): string[] {
    return mutateModule.preview(plan);
  }

  async mutate(plan: MutationPlan, ctx: OpCtx): Promise<MutationResult> {
    return mutateModule.mutate(this.requireHandle(), ctx, this.readOnly, plan);
  }

  async execute(req: ConsoleRequest, ctx: OpCtx): Promise<Page[]> {
    return executeConsole(this.requireHandle(), ctx, req.statements);
  }

  async downloadObject(): Promise<ObjectTransferResult> {
    // caps.fileTransfer === false — no UI ever offers Download for this engine; never reached.
    unsupported(this.kind, 'file transfer');
  }

  // D4: there is no sqlite3_interrupt in node:sqlite, and its entire API is synchronous — a
  // running statement blocks the engine's own event loop, so an abort could never even be
  // delivered while one runs. The scheduler still aborts the local signal on its own (an op that
  // has not yet started still rejects E_CANCELLED); this is the honest "cannot forward it" answer
  // adapter.ts's own doc comment specifies for caps.cancel === false.
  async cancel(): Promise<boolean> {
    return false;
  }

  private requireHandle(): SqliteHandle {
    if (!this.handle) throw new AdapterError('E_CONNECT', 'adapter is not connected');
    return this.handle;
  }

  private execFor(ctx: OpCtx): catalog.QueryExecutor {
    return (sql, params) => runQuery(this.requireHandle(), sql, params ?? [], ctx);
  }
}

export function createSqliteAdapter(deps: AdapterDeps): Adapter {
  return new SqliteAdapter(deps);
}

// Re-exported so tests/db/sqlite.spec.ts can import the same identifier-quoting rule the adapter
// itself uses, mirroring mysql-family/read.ts's own quoteIdent export.
export { quoteIdent };
