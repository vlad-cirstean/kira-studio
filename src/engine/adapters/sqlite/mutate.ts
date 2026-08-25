import type { MutationPlan, MutationResult } from '@shared/domain/mutations';
import type { OpCtx } from '../adapter';
import { assertWritable } from '../errors';
import {
  assertAffectedExactlyOne,
  assertColumnsKnown,
  assertKeyIsPrimaryKey,
  createParamRenderer,
  literalRenderer,
  orderedOps,
  renderRowOp,
  resolveDatabaseTablePath,
} from '../sql-mutate';
import * as catalog from './catalog';
import type { SqliteHandle } from './client';
import { execLiteral, runCommand, runQuery, type SqliteParam } from './query';
import { quoteIdent } from './read';

const paramRenderer = createParamRenderer<SqliteParam>(() => '?');

// Synchronous, no catalog lookup, no I/O — trusts the plan's column names as given (Adapter rule).
export function preview(plan: MutationPlan): string[] {
  const { database, table } = resolveDatabaseTablePath(plan.path);
  const relationSql = `${quoteIdent(database)}.${quoteIdent(table)}`;
  return orderedOps(plan.ops).map((op) =>
    renderRowOp(relationSql, op, literalRenderer, [], quoteIdent),
  );
}

// D25: BEGIN IMMEDIATE, not a deferred BEGIN — a deferred transaction only takes its write lock at
// the first write, so a contended file would fail mid-batch; IMMEDIATE takes the lock up front, so
// a busy database fails before a single row has changed.
export function mutate(
  h: SqliteHandle,
  ctx: OpCtx,
  readOnly: boolean,
  plan: MutationPlan,
): MutationResult {
  assertWritable(readOnly);

  const { database: schema, table } = resolveDatabaseTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  // Fresh in this same op — never trusts a column name the renderer sent without re-checking it
  // against the catalog right now (same discipline resolveProjection uses on the read path).
  const execSelect: catalog.QueryExecutor = (sql, params) => runQuery(h, sql, params ?? [], ctx);
  const target = catalog.getReadTarget(execSelect, schema, table);

  const qualifiedName = `${target.qualifiedName.schema}.${target.qualifiedName.table}`;
  // D23: the table's own rowid, even when it exists and is used internally for keyset paging, is
  // never an acceptable key here — it is not a column the renderer ever shows.
  for (const op of plan.ops) {
    if (op.kind === 'update') {
      assertColumnsKnown(target.columns, [...Object.keys(op.key), ...Object.keys(op.changes)]);
      assertKeyIsPrimaryKey(target.primaryKey, op.key, qualifiedName);
    } else if (op.kind === 'delete') {
      assertColumnsKnown(target.columns, Object.keys(op.key));
      assertKeyIsPrimaryKey(target.primaryKey, op.key, qualifiedName);
    } else {
      assertColumnsKnown(target.columns, Object.keys(op.values));
    }
  }

  const ordered = orderedOps(plan.ops);
  const compiled = ordered.map((op) => {
    const params: SqliteParam[] = [];
    const sql = renderRowOp(relationSql, op, paramRenderer, params, quoteIdent);
    return { op, sql, params };
  });
  // One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5's own
  // precedent).
  ctx.setCommand(
    ordered.map((op) => renderRowOp(relationSql, op, literalRenderer, [], quoteIdent)).join(';\n'),
  );

  execLiteral(h, 'BEGIN IMMEDIATE');
  let affectedRows = 0;
  try {
    for (const { op, sql, params } of compiled) {
      const { affectedRows: n } = runCommand(h, sql, params, ctx, { suppressCommand: true });
      assertAffectedExactlyOne(op.kind, n);
      affectedRows += n;
    }
    execLiteral(h, 'COMMIT');
  } catch (err) {
    try {
      execLiteral(h, 'ROLLBACK');
    } catch {
      // best-effort, mirrors the other SQL adapters' own ROLLBACK-after-failure discipline
    }
    throw err;
  }
  return { affectedRows };
}
