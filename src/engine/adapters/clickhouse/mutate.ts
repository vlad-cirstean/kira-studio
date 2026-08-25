import type { MutationPlan, MutationResult, MutationRowOp } from '../../../shared/domain/mutations';
import { encodePath } from '../../../shared/domain/tree';
import type { OpCtx } from '../adapter';
import { AdapterError, assertWritable } from '../errors';
import { assertColumnsKnown } from '../sql-mutate';
import * as catalog from './catalog';
import type { ClickHouseHandle } from './client';
import { runCatalogQuery, runCommand, type TrackQuery } from './query';
import { quoteIdent } from './read';

// D24/D25: MergeTree's PRIMARY KEY is a sparse index, not a unique key (F16) — there is no way to
// address "this one row" for an UPDATE or DELETE, so canUpdate/canDelete are permanently false
// (caps.ts) and every non-insert op is refused, mirroring kafka/produce.ts's assertInsert for the
// identical structural reason (an immutable log has no addressable row either).
function assertInsertOnly(
  op: MutationRowOp,
): asserts op is Extract<MutationRowOp, { kind: 'insert' }> {
  if (op.kind !== 'insert') {
    throw new AdapterError(
      'E_UNSUPPORTED',
      'ClickHouse only supports adding new rows (insert): a MergeTree PRIMARY KEY is a sparse ' +
        'index, not a unique key, so there is no addressable row to update or delete',
    );
  }
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

// D6/F27: backslash-then-quote — ClickHouse string literals use backslash escapes (F27), not
// SQL's standard doubled-quote convention every other adapter in this codebase renders with.
function literalFor(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// D24: every insert op in one plan renders as a single multi-row INSERT statement — cheaper than
// one round trip per row (F19: ClickHouse is built for batch writes, not row-at-a-time OLTP), and
// what mutate() actually executes below, so preview() must render the same shape it would run
// (§8.13's "exact-command" contract) rather than one line per op. Columns are the UNION across
// every op, not assumed uniform: a plan's ops could in principle carry different value sets, and
// an op missing a given column pads that row's tuple with NULL rather than silently misaligning.
function renderInsert(
  relationSql: string,
  ops: Extract<MutationRowOp, { kind: 'insert' }>[],
  render: (value: string | null) => string,
): string {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    for (const col of Object.keys(op.values)) {
      if (!seen.has(col)) {
        seen.add(col);
        columns.push(col);
      }
    }
  }
  const columnSql = columns.map((c) => quoteIdent(c)).join(', ');
  const rows = ops.map((op) => {
    const tuple = columns.map((c) => render(op.values[c] ?? null)).join(', ');
    return `(${tuple})`;
  });
  return `INSERT INTO ${relationSql} (${columnSql}) VALUES ${rows.join(', ')}`;
}

// Synchronous (Adapter rule 3/§8.13): no catalog lookup, no network — trusts the plan's column
// names as given, exactly like every other adapter's own preview().
export function preview(plan: MutationPlan): string[] {
  const { schema, table } = resolveTablePath(plan.path);
  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  plan.ops.forEach(assertInsertOnly);
  const inserts = plan.ops as Extract<MutationRowOp, { kind: 'insert' }>[];
  if (inserts.length === 0) return [];
  return [renderInsert(relationSql, inserts, literalFor)];
}

export async function mutate(
  h: ClickHouseHandle,
  ctx: OpCtx,
  track: TrackQuery,
  readOnly: boolean,
  plan: MutationPlan,
  nextQueryId: () => string,
): Promise<MutationResult> {
  // §8.12's standard: enforced here, not only greyed out in the UI (P5 D11).
  assertWritable(readOnly);

  const { schema, table } = resolveTablePath(plan.path);
  plan.ops.forEach(assertInsertOnly);
  const inserts = plan.ops as Extract<MutationRowOp, { kind: 'insert' }>[];
  if (inserts.length === 0) return { affectedRows: 0 };

  // Fresh in this same op (D7, mirrors resolveProjection's own discipline) — never trusts a
  // column name the renderer sent without re-checking it against the catalog right now.
  const exec: catalog.QueryExecutor = (sql, params) =>
    runCatalogQuery(h, ctx, sql, { queryId: nextQueryId() }, track, params);
  const target = await catalog.getReadTarget(exec, schema, table);
  for (const op of inserts) assertColumnsKnown(target.columns, Object.keys(op.values));

  const relationSql = `${quoteIdent(schema)}.${quoteIdent(table)}`;
  const sql = renderInsert(relationSql, inserts, literalFor);
  ctx.setCommand(sql);
  const { writtenRows } = await runCommand(h, ctx, sql, { queryId: nextQueryId() }, track);
  return { affectedRows: writtenRows > 0 ? writtenRows : inserts.length };
}
