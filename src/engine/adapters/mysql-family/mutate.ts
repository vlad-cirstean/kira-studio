import type { MutationPlan, MutationResult } from '@shared/domain/mutations';
import type { Connection } from 'mariadb';
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
import { runCommand, runQuery, type TrackQuery } from './query';
import { quoteIdent } from './read';

const paramRenderer = createParamRenderer<unknown>(() => '?');

// Synchronous (D6): no catalog lookup, no network — trusts the plan's column names as given.
export function preview(plan: MutationPlan): string[] {
  const { database, table } = resolveDatabaseTablePath(plan.path);
  const relationSql = `${quoteIdent(database)}.${quoteIdent(table)}`;
  return orderedOps(plan.ops).map((op) =>
    renderRowOp(relationSql, op, literalRenderer, [], quoteIdent),
  );
}

export async function mutate(
  conn: Connection,
  ctx: OpCtx,
  track: TrackQuery,
  readOnly: boolean,
  plan: MutationPlan,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (P5 D11).
  assertWritable(readOnly);

  const { database, table } = resolveDatabaseTablePath(plan.path);
  const relationSql = `${quoteIdent(database)}.${quoteIdent(table)}`;

  // Fresh in this same op (D7, mirrors resolveProjection's P2 D10 discipline) — never trusts a
  // column name the renderer sent without re-checking it against the catalog right now.
  const execSelect: catalog.QueryExecutor = (sql, params) =>
    runQuery(conn, sql, params, ctx, track);
  const target = await catalog.getReadTarget(execSelect, database, table);

  const qualifiedName = `${target.qualifiedName.database}.${target.qualifiedName.table}`;
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
    const params: unknown[] = [];
    const sql = renderRowOp(relationSql, op, paramRenderer, params, quoteIdent);
    return { op, sql, params };
  });
  // One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9).
  ctx.setCommand(
    ordered.map((op) => renderRowOp(relationSql, op, literalRenderer, [], quoteIdent)).join(';\n'),
  );

  const execCommand = (sql: string, params: unknown[]) =>
    runCommand(conn, sql, params, ctx, track, { suppressCommand: true });

  await execCommand('START TRANSACTION', []);
  let affectedRows = 0;
  try {
    for (const { op, sql, params } of compiled) {
      const { affectedRows: n } = await execCommand(sql, params);
      assertAffectedExactlyOne(op.kind, n);
      affectedRows += n;
    }
    await execCommand('COMMIT', []);
  } catch (err) {
    await execCommand('ROLLBACK', []).catch(() => {});
    throw err;
  }
  return { affectedRows };
}
