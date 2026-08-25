import type { MutationRowOp } from '../../shared/domain/mutations';
import type { ColumnMeta } from '../../shared/domain/tree';
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
