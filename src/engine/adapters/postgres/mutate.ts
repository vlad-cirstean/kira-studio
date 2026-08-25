import type { MutationPlan, MutationResult, MutationRowOp } from '@shared/domain/mutations';
import { encodePath } from '@shared/domain/tree';
import type { Client } from 'pg';
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

// Renders one row-op's statement text. preview() (never executes, D6) inlines an escaped SQL
// literal for each value; mutate() pushes a `$n` placeholder onto `params` instead — the two stay
// textually identical in shape (column list, WHERE construction) by sharing this one builder.
type ValueRenderer = (value: string | null, params: unknown[]) => string;

function literalRenderer(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function paramRenderer(value: string | null, params: unknown[]): string {
  params.push(value);
  return `$${params.length}`;
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

function resolveTablePath(path: MutationPlan['path']): { schema: string; table: string } {
  const [, schemaSegment, objectSegment] = path.segments;
  if (
    path.segments.length !== 3 ||
    schemaSegment?.kind !== 'schema' ||
    !objectSegment ||
    objectSegment.kind !== 'table'
  ) {
    throw new AdapterError(
      'E_NOT_FOUND',
      `mutate requires a database/schema/table path, got: ${encodePath(path.segments)}`,
    );
  }
  return { schema: schemaSegment.name, table: objectSegment.name };
}

// Synchronous (D6): no catalog lookup, no network — trusts the plan's column names as given.
export function preview(plan: MutationPlan): string[] {
  const { schema, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  return orderedOps(plan.ops).map((op) => renderRowOp(relationSql, op, literalRenderer, []));
}

export async function mutate(
  client: Client,
  ctx: OpCtx,
  track: TrackQuery,
  readOnly: boolean,
  plan: MutationPlan,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (P5 D11).
  assertWritable(readOnly);

  const { schema, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  // Fresh in this same op (D7, mirrors resolveProjection's P2 D10 discipline) — never trusts a
  // column name the renderer sent without re-checking it against the catalog right now.
  const execSelect: catalog.QueryExecutor = (sql, params) =>
    runQuery(client, sql, params, ctx, track);
  const target = await catalog.getReadTarget(execSelect, schema, table);

  const qualifiedName = `${target.qualifiedName.schema}.${target.qualifiedName.relation}`;
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
    runCommand(client, sql, params, ctx, track, { suppressCommand: true });

  await execCommand('BEGIN', []);
  let affectedRows = 0;
  try {
    for (const { op, sql, params } of compiled) {
      const { rowCount } = await execCommand(sql, params);
      assertAffectedExactlyOne(op.kind, rowCount);
      affectedRows += rowCount;
    }
    await execCommand('COMMIT', []);
  } catch (err) {
    await execCommand('ROLLBACK', []).catch(() => {});
    throw err;
  }
  return { affectedRows };
}
