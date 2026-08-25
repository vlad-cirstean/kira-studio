import type { ConstraintMeta, ObjectDefinition } from '../../../shared/domain/definition';
import { decodePath, encodePath, type NodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import type { QueryExecutor, ReadTarget } from './catalog';
import * as catalog from './catalog';
import { quoteIdent } from './read';

export type RelationLikeKind = 'table' | 'view';

interface SqliteMasterRow {
  sql: string | null;
}

// SHOW CREATE TABLE has no SQLite analogue — sqlite_master.sql already *is* the CREATE statement
// as the user (or a prior migration) wrote it, verbatim, so this is "asked, never composed" in
// its simplest possible form (the position mysql-family/definition.ts:97-101 takes about
// SHOW CREATE TABLE — SQLite just skips the round trip through the server entirely).
function stripOneTrailingSemicolon(text: string): string {
  const match = /;\s*$/.exec(text);
  return match ? text.slice(0, text.length - match[0].length) : text;
}

// F19/D24: SQLite has no CHECK-constraint catalog at all — a CHECK is visible only inside the
// CREATE statement's own text, which the Source pane already shows verbatim. Listing PK/UNIQUE/FK
// here (composed from the same pragmas describe() uses) and saying so for CHECK beats an empty
// Constraints section that looks like there simply are none.
function buildConstraints(
  exec: QueryExecutor,
  schema: string,
  table: string,
  target: ReadTarget,
): ConstraintMeta[] {
  const constraints: ConstraintMeta[] = [];
  if (target.primaryKey && target.primaryKey.length > 0) {
    constraints.push({
      name: `${table}_pkey`,
      type: 'primaryKey',
      definition: `(${target.primaryKey.map(quoteIdent).join(', ')})`,
    });
  }

  for (const idx of catalog.listIndexes(exec, table)) {
    if (idx.primary || !idx.unique) continue; // PK covered above; a plain index isn't a constraint
    constraints.push({
      name: idx.name,
      type: 'unique',
      definition: `(${idx.columns.map(quoteIdent).join(', ')})`,
    });
  }

  for (const fk of catalog.listForeignKeys(exec, schema, table)) {
    const refTable = decodePath('', fk.referencedPath).segments.at(-1)?.name ?? '';
    constraints.push({
      name: fk.name,
      type: 'foreignKey',
      definition:
        `(${fk.columns.map(quoteIdent).join(', ')}) REFERENCES ${quoteIdent(refTable)} ` +
        `(${fk.referencedColumns.map(quoteIdent).join(', ')})`,
    });
  }

  return constraints;
}

export function buildDefinition(
  exec: QueryExecutor,
  segments: NodePath['segments'],
  schema: string,
  object: { kind: RelationLikeKind; name: string },
): ObjectDefinition {
  const masterType = object.kind === 'view' ? 'view' : 'table';
  const rows = exec<SqliteMasterRow>('SELECT sql FROM sqlite_master WHERE type = ? AND name = ?', [
    masterType,
    object.name,
  ]);
  const raw = rows[0]?.sql;
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AdapterError(
      'E_QUERY',
      `sqlite_master returned no definition for "${schema}"."${object.name}"`,
    );
  }
  const statement = stripOneTrailingSemicolon(raw);

  let constraints: ConstraintMeta[] = [];
  let notes: string[] = [];
  if (object.kind === 'table') {
    const target = catalog.getReadTarget(exec, schema, object.name);
    constraints = buildConstraints(exec, schema, object.name, target);
    notes = [
      'CHECK constraints, if any, appear only in the Source text above — SQLite has no separate ' +
        'catalog for them.',
    ];
  }

  return {
    path: encodePath(segments),
    kind: object.kind,
    qualifiedName: `${schema}.${object.name}`,
    statements: [statement],
    language: 'sql',
    origin: 'server',
    notes,
    constraints,
    documentSchema: null,
    sections: [],
    generatedAt: new Date().toISOString(),
  };
}
