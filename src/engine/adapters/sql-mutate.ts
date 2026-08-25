import type { MutationPlan, MutationRowOp } from '@shared/domain/mutations';
import { type ColumnMeta, encodePath } from '@shared/domain/tree';
import { AdapterError } from './errors';

// P39 iter2 F16: postgres/mysql-family/sqlite each declared this same ordering — D8: delete, then
// update, then insert, regardless of the plan's own array order. A P5 semantic rule, not a
// dialect one, so it lives beside the mutation guards rather than in sql-text.ts (which is about
// SQL text, not MutationRowOp/ColumnMeta semantics).
const KIND_RANK: Record<MutationRowOp['kind'], number> = { delete: 0, update: 1, insert: 2 };
export function orderedOps(ops: MutationRowOp[]): MutationRowOp[] {
  return [...ops].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]);
}

// P36 D28: a generated column (ClickHouse's MATERIALIZED/ALIAS, MySQL/Postgres's GENERATED
// ALWAYS AS, ...) is deliberately NOT blocked here — the renderer's own insert paths already skip
// it (ColumnDescriptor.generated), and an explicit mutate() call that targets one anyway is left
// for the server to refuse in its own words (Adapter rule 4) rather than a second, app-invented
// message ahead of it. Takes the column list rather than each adapter's own ReadTarget — this
// reads only ColumnMeta.name, and the four ReadTargets genuinely differ otherwise (D17's own
// precedent in sql-text.ts).
export function assertColumnsKnown(columns: ColumnMeta[], names: string[]): void {
  const known = new Set(columns.map((c) => c.name));
  for (const name of names) {
    if (!known.has(name))
      throw new AdapterError('E_NOT_FOUND', `unknown column in mutation: ${name}`);
  }
}

export function assertAffectedExactlyOne(kind: string, n: number): void {
  if (n !== 1) {
    throw new AdapterError('E_QUERY', `expected ${kind} to affect exactly one row, affected ${n}`);
  }
}

// A partial or missing primary key is not a safe row identifier (P5 D1/D2) — enforced here too,
// not only by the renderer graying out editing for a keyless table. `qualifiedName` is the
// already-built display string each adapter spells its own way (schema.relation / database.table
// / schema.table) — passed in so all three messages stay byte-identical to what each adapter
// threw before this was hoisted (D16's own precedent for unsupported()/noQueryConsole()).
export function assertKeyIsPrimaryKey(
  primaryKey: string[] | null,
  key: Record<string, string | null>,
  qualifiedName: string,
): void {
  if (!primaryKey || primaryKey.length === 0) {
    throw new AdapterError('E_UNSUPPORTED', `${qualifiedName} has no primary key`);
  }
  const given = Object.keys(key).sort();
  const pk = [...primaryKey].sort();
  if (given.length !== pk.length || given.some((c, i) => c !== pk[i])) {
    throw new AdapterError('E_QUERY', 'row key must be exactly the primary key columns');
  }
}

// P39 iter3 F15/D17: postgres/mysql-family/sqlite's mutate.ts each wrote out this exact renderer.
// Diffed character-for-character, the only real difference across all three is the placeholder
// each dialect's paramRenderer emits ($n vs ?) — sql-text.ts's own buildKeysetPredicate already
// takes exactly this as a parameter, for the same reason. Generic over the params element type
// covers unknown[] (postgres/mysql-family) vs SqliteParam[] (sqlite). ClickHouse is not part of
// this: it renders insert-only batches through its own renderInsert/literalFor, a different
// statement shape, not a different dialect of the same one.
export type ValueRenderer<P> = (value: string | null, params: P[]) => string;

/** preview()'s renderer (D6: never executes) — an escaped SQL literal, no params touched. */
export function literalRenderer(value: string | null): string {
  if (value === null) return 'NULL';
  return `'${value.replace(/'/g, "''")}'`;
}

/** mutate()'s renderer — pushes onto `params` and returns the dialect's placeholder for the
 *  position it landed at. `placeholder` is the one thing the three copies disagreed on. */
export function createParamRenderer<P>(placeholder: (n: number) => string): ValueRenderer<P> {
  return (value, params) => {
    params.push(value as P);
    return placeholder(params.length);
  };
}

function whereFromKey<P>(
  key: Record<string, string | null>,
  render: ValueRenderer<P>,
  params: P[],
  quote: (name: string) => string,
): string {
  return Object.entries(key)
    .map(([col, val]) =>
      val === null ? `${quote(col)} IS NULL` : `${quote(col)} = ${render(val, params)}`,
    )
    .join(' AND ');
}

/** UPDATE/DELETE/INSERT text for one row op, with the WHERE built from the row key. `quote` is
 *  the caller's own quoteIdent, so every emitted string is byte-identical to today's. */
export function renderRowOp<P>(
  relationSql: string,
  op: MutationRowOp,
  render: ValueRenderer<P>,
  params: P[],
  quote: (name: string) => string,
): string {
  if (op.kind === 'update') {
    const setSql = Object.entries(op.changes)
      .map(([col, val]) => `${quote(col)} = ${render(val, params)}`)
      .join(', ');
    return `UPDATE ${relationSql} SET ${setSql} WHERE ${whereFromKey(op.key, render, params, quote)}`;
  }
  if (op.kind === 'delete') {
    return `DELETE FROM ${relationSql} WHERE ${whereFromKey(op.key, render, params, quote)}`;
  }
  const columns = Object.keys(op.values);
  const columnSql = columns.map((c) => quote(c)).join(', ');
  const valueSql = columns.map((c) => render(op.values[c], params)).join(', ');
  return `INSERT INTO ${relationSql} (${columnSql}) VALUES (${valueSql})`;
}

// P39 iter3 F16/D18: clickhouse/mysql-family/sqlite's mutate.ts each wrote out this same
// two-segment database/table path check, message included — the only difference was whether the
// private destructuring named the first segment `database` or `schema`, which no emitted string
// depends on. postgres/mutate.ts keeps its own resolveTablePath: a genuinely different path shape
// (three segments, a real `schema` kind) with its own message.
export function resolveDatabaseTablePath(path: MutationPlan['path']): {
  database: string;
  table: string;
} {
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
