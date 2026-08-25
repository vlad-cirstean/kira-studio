import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError } from '../errors';
import * as catalog from './catalog';
import type { SqliteHandle } from './client';
import { execLiteral, runCommand, runQuery, type SqliteParam } from './query';
import { quoteIdent } from './read';

// Mirrors mysql-family/mutate.ts's renderer exactly — see its comments for the shared-shape
// rationale (P5's own precedent, one design used by every SQL adapter).
type ValueRenderer = (value: string | null, params: SqliteParam[]) => string;

function literalRenderer(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

function paramRenderer(value: string | null, params: SqliteParam[]): string {
  params.push(value);
  return '?';
}

function whereFromKey(
  key: Record<string, string | null>,
  render: ValueRenderer,
  params: SqliteParam[],
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
  params: SqliteParam[],
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

// D8: delete, then update, then insert, regardless of the plan's own array order.
const KIND_RANK: Record<MutationRowOp['kind'], number> = { delete: 0, update: 1, insert: 2 };
function orderedOps(ops: MutationRowOp[]): MutationRowOp[] {
  return [...ops].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

function resolveTablePath(path: MutationPlan['path']): { schema: string; table: string } {
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
  return { schema: databaseSegment.name, table: objectSegment.name };
}

// Synchronous, no catalog lookup, no I/O — trusts the plan's column names as given (Adapter rule).
export function preview(plan: MutationPlan): string[] {
  const { schema, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  return orderedOps(plan.ops).map((op) => renderRowOp(relationSql, op, literalRenderer, []));
}

function assertColumnsKnown(target: catalog.ReadTarget, columns: string[]): void {
  const known = new Set(target.columns.map((c) => c.name));
  for (const c of columns) {
    if (!known.has(c)) throw new AdapterError('E_NOT_FOUND', `unknown column in mutation: ${c}`);
  }
}

// A partial or missing primary key is not a safe row identifier (P5's own rule) — enforced here
// too, not only by the renderer graying out editing for a keyless table. D23: the table's own
// rowid, even when it exists and is used internally for keyset paging, is never an acceptable key
// here — it is not a column the renderer ever shows.
function assertKeyIsPrimaryKey(
  target: catalog.ReadTarget,
  key: Record<string, string | null>,
): void {
  if (!target.primaryKey || target.primaryKey.length === 0) {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `${target.qualifiedName.schema}.${target.qualifiedName.table} has no primary key`,
    );
  }
  const given = Object.keys(key).sort();
  const pk = [...target.primaryKey].sort();
  if (given.length !== pk.length || given.some((c, i) => c !== pk[i])) {
    throw new AdapterError('E_QUERY', 'row key must be exactly the primary key columns');
  }
}

function assertAffectedExactlyOne(kind: string, n: number): void {
  if (n !== 1) {
    throw new AdapterError('E_QUERY', `expected ${kind} to affect exactly one row, affected ${n}`);
  }
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
  if (readOnly) throw new AdapterError('E_UNSUPPORTED', 'connection is read-only');

  const { schema, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;

  // Fresh in this same op — never trusts a column name the renderer sent without re-checking it
  // against the catalog right now (same discipline resolveProjection uses on the read path).
  const execSelect: catalog.QueryExecutor = (sql, params) => runQuery(h, sql, params ?? [], ctx);
  const target = catalog.getReadTarget(execSelect, schema, table);

  for (const op of plan.ops) {
    if (op.kind === 'update') {
      assertColumnsKnown(target, [...Object.keys(op.key), ...Object.keys(op.changes)]);
      assertKeyIsPrimaryKey(target, op.key);
    } else if (op.kind === 'delete') {
      assertColumnsKnown(target, Object.keys(op.key));
      assertKeyIsPrimaryKey(target, op.key);
    } else {
      assertColumnsKnown(target, Object.keys(op.values));
    }
  }

  const ordered = orderedOps(plan.ops);
  const compiled = ordered.map((op) => {
    const params: SqliteParam[] = [];
    const sql = renderRowOp(relationSql, op, paramRenderer, params);
    return { op, sql, params };
  });
  // One op-log row, one setCommand call, before anything executes (Adapter rule 3, P5's own
  // precedent).
  ctx.setCommand(
    ordered.map((op) => renderRowOp(relationSql, op, literalRenderer, [])).join(';\n'),
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
