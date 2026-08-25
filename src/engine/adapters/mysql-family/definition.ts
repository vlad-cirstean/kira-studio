import type { ConstraintMeta, ObjectDefinition } from '../../../shared/domain/definition';
import { encodePath, type NodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import { stripOneTrailingSemicolon } from '../sql-text';
import type { QueryExecutor } from './catalog';
import { quoteIdent } from './read';

export type RelationLikeKind = 'table' | 'view';

interface TableTypeRow {
  TABLE_TYPE: string;
}

interface TableConstraintRow {
  name: string;
  type: string; // 'PRIMARY KEY' | 'UNIQUE' | 'FOREIGN KEY' | 'CHECK'
  check_clause: string | null;
}

interface KeyColumnRow {
  name: string;
  col: string;
  ref_table: string | null;
  ref_col: string | null;
}

const CONSTRAINT_TYPE: Record<string, ConstraintMeta['type']> = {
  'PRIMARY KEY': 'primaryKey',
  UNIQUE: 'unique',
  'FOREIGN KEY': 'foreignKey',
  CHECK: 'check',
};

// MariaDB has no `pg_get_constraintdef`-style builtin (P19 D11) — the key-column list and the
// FK's referenced table/columns are composed from information_schema itself, not invented SQL
// syntax; a CHECK constraint's clause is the engine's own CHECK_CONSTRAINTS.CHECK_CLAUSE text,
// rendered verbatim like everything else in this file.
async function listConstraints(
  exec: QueryExecutor,
  database: string,
  tableName: string,
): Promise<ConstraintMeta[]> {
  const constraints = await exec<TableConstraintRow>(
    `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type, cc.CHECK_CLAUSE AS check_clause
     FROM information_schema.TABLE_CONSTRAINTS tc
     LEFT JOIN information_schema.CHECK_CONSTRAINTS cc
       ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
     WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
     ORDER BY FIELD(tc.CONSTRAINT_TYPE, 'PRIMARY KEY', 'UNIQUE', 'CHECK', 'FOREIGN KEY'),
              tc.CONSTRAINT_NAME`,
    [database, tableName],
  );
  if (constraints.length === 0) return [];

  const keyColumns = await exec<KeyColumnRow>(
    `SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS col,
            REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_col
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
     ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`,
    [database, tableName],
  );
  const columnsByConstraint = new Map<string, KeyColumnRow[]>();
  for (const row of keyColumns) {
    const list = columnsByConstraint.get(row.name) ?? [];
    list.push(row);
    columnsByConstraint.set(row.name, list);
  }

  return constraints.map((c): ConstraintMeta => {
    const type = CONSTRAINT_TYPE[c.type] ?? 'check';
    if (type === 'check') {
      return { name: c.name, type, definition: c.check_clause ?? '' };
    }
    const cols = columnsByConstraint.get(c.name) ?? [];
    const columnList = `(${cols.map((r) => r.col).join(', ')})`;
    if (type === 'foreignKey') {
      const refTable = cols[0]?.ref_table ?? '';
      const refColumnList = `(${cols.map((r) => r.ref_col ?? '').join(', ')})`;
      return {
        name: c.name,
        type,
        definition: `${columnList} REFERENCES ${refTable} ${refColumnList}`,
      };
    }
    return { name: c.name, type, definition: columnList };
  });
}

/**
 * Passes `SHOW CREATE …` through verbatim — MariaDB is asked, never composed. The one identifier
 * that must reach the statement text goes through `quoteIdent`, resolved from
 * `information_schema` (with bound parameters) in this same op — Adapter rule 7.
 */
export async function buildDefinition(
  exec: QueryExecutor,
  segments: NodePath['segments'],
  database: string,
  object: { kind: RelationLikeKind; name: string },
): Promise<ObjectDefinition> {
  const [resolved] = await exec<TableTypeRow>(
    `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, object.name],
  );
  if (!resolved) {
    throw new AdapterError('E_NOT_FOUND', `relation "${database}"."${object.name}" not found`);
  }

  const qualified = `${quoteIdent(database)}.${quoteIdent(object.name)}`;
  let statement: string;
  let notes: string[];
  let constraintMetas: ConstraintMeta[] = [];

  if (resolved.TABLE_TYPE === 'BASE TABLE') {
    const [row] = await exec<Record<string, unknown>>(`SHOW CREATE TABLE ${qualified}`, []);
    const raw = row?.['Create Table'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new AdapterError(
        'E_QUERY',
        `SHOW CREATE TABLE returned no definition for "${database}"."${object.name}"`,
      );
    }
    statement = stripOneTrailingSemicolon(raw);
    notes = ['Triggers and grants are not included in SHOW CREATE TABLE.'];
    constraintMetas = await listConstraints(exec, database, object.name);
  } else if (resolved.TABLE_TYPE === 'VIEW') {
    const [row] = await exec<Record<string, unknown>>(`SHOW CREATE VIEW ${qualified}`, []);
    const raw = row?.['Create View'];
    if (typeof raw !== 'string' || raw.length === 0) {
      throw new AdapterError(
        'E_QUERY',
        `SHOW CREATE VIEW returned no definition for "${database}"."${object.name}"`,
      );
    }
    statement = stripOneTrailingSemicolon(raw);
    notes = [
      "This is the server's own SHOW CREATE VIEW text, including its DEFINER and SQL SECURITY clauses.",
    ];
  } else {
    throw new AdapterError(
      'E_UNSUPPORTED',
      `definition is not supported for ${resolved.TABLE_TYPE}`,
    );
  }

  return {
    path: encodePath(segments),
    kind: object.kind,
    qualifiedName: `${database}.${object.name}`,
    statements: [statement],
    language: 'sql',
    origin: 'server',
    notes,
    constraints: constraintMetas,
    documentSchema: null,
    sections: [],
    generatedAt: new Date().toISOString(),
  };
}
