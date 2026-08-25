import type { Connection } from 'mariadb';
import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import {
  assertAffectedExactlyOne,
  assertColumnsKnown,
  assertKeyIsPrimaryKey,
  orderedOps,
} from '../sql-mutate';
import * as catalog from './catalog';
import { runCommand, runQuery, type TrackQuery } from './query';
import { quoteIdent } from './read';

// Mirrors postgres/mutate.ts's renderer exactly — see its comments for the shared-shape rationale.
type ValueRenderer = (value: string | null, params: unknown[]) => string;

function literalRenderer(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function paramRenderer(value: string | null, params: unknown[]): string {
  params.push(value);
  return '?';
}

function whereFromKey(
  key: Record<string, string | null>,
  render: ValueRenderer,
  params: unknown[],
): string {
  return Object.entries(key)
    .map(([col, val]) =>
      val === null ? `${quoteIdent(col)} IS NULL` : `${quoteIdent(col)} = ${render(val, params)}`,
    )
    .join(' AND ');
}

function renderRowOp(
  relationSql: string,
  op: MutationRowOp,
  render: ValueRenderer,
  params: unknown[],
): string {
  if (op.kind === 'update') {
    const setSql = Object.entries(op.changes)
      .map(([col, val]) => `${quoteIdent(col)} = ${render(val, params)}`)
      .join(', ');
    return `UPDATE ${relationSql} SET ${setSql} WHERE ${whereFromKey(op.key, render, params)}`;
  }
  if (op.kind === 'delete') {
    return `DELETE FROM ${relationSql} WHERE ${whereFromKey(op.key, render, params)}`;
  }
  const columns = Object.keys(op.values);
  const columnSql = columns.map((c) => quoteIdent(c)).join(', ');
  const valueSql = columns.map((c) => render(op.values[c], params)).join(', ');
  return `INSERT INTO ${relationSql} (${columnSql}) VALUES (${valueSql})`;
}

function resolveTablePath(path: MutationPlan['path']): { database: string; table: string } {
  const [databaseSegment, objectSegment] = path.segments;
  if (
    path.segments.length !== 2 ||
    databaseSegment?.kind !== 'database' ||
    !objectSegment ||
    objectSegment.kind !== 'table'
  ) {
    throw new AdapterError(
      'E_NOT_FOUND',
      `mutate requires a database/table path, got: ${encodePath(path.segments)}`,
    );
  }
  return { database: databaseSegment.name, table: objectSegment.name };
}

// Synchronous (D6): no catalog lookup, no network — trusts the plan's column names as given.
export function preview(plan: MutationPlan): string[] {
  const { database, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(database)}.${quoteIdent(table)}`;
  return orderedOps(plan.ops).map((op) => renderRowOp(relationSql, op, literalRenderer, []));
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

  const { database, table } = resolveTablePath(plan.path);
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
    const sql = renderRowOp(relationSql, op, paramRenderer, params);
    return { op, sql, params };
  });
  // One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5 D9).
  ctx.setCommand(
    ordered.map((op) => renderRowOp(relationSql, op, literalRenderer, [])).join(';\n'),
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
