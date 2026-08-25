import type {
  ConstraintMeta,
  DefinitionSection,
  ObjectDefinition,
} from '../../../shared/domain/definition';
import { encodePath, type NodePath } from '../../../shared/domain/tree';
import { AdapterError } from '../errors';
import { stripOneTrailingSemicolon } from '../sql-text';
import type { QueryExecutor } from './catalog';
import * as catalog from './catalog';

// D18: system.constraints has no primary/unique/foreign-key rows at all (F17/F16 — a MergeTree
// PRIMARY KEY is a sparse index, not a constraint the catalog tracks this way), so this section is
// CHECK-only rather than a partial imitation of what postgres/mariadb's constraints list shows.
function toConstraintMeta(row: { name: string; expression: string }): ConstraintMeta {
  return { name: row.name, type: 'check', definition: row.expression };
}

// P23 D6: the "Table properties" section — this adapter's first real use of the generic
// name/value block every other SQL engine's definition() leaves empty, since none of Engine,
// Sorting key, Partition key or the sparse Primary key expression has anywhere else in
// ObjectDefinition to live.
function buildTableSection(target: catalog.ReadTarget): DefinitionSection {
  const rows: DefinitionSection['rows'] = [
    { name: 'Engine', value: target.engine, detail: null },
    { name: 'Sorting key', value: target.sortingKey || '(none)', detail: null },
    { name: 'Primary key', value: target.primaryKeyExpression || '(none)', detail: null },
    { name: 'Partition key', value: target.partitionKey || '(none)', detail: null },
    {
      name: 'Total rows',
      value: target.totalRows !== null ? target.totalRows.toLocaleString() : '(unknown)',
      detail: null,
    },
  ];
  if (target.comment) rows.push({ name: 'Comment', value: target.comment, detail: null });
  return { title: 'Table properties', rows };
}

export async function buildDefinition(
  exec: QueryExecutor,
  segments: NodePath['segments'],
  schema: string,
  object: { kind: 'table' | 'view' | 'matview'; name: string },
): Promise<ObjectDefinition> {
  const target = await catalog.getReadTarget(exec, schema, object.name);
  const statement = stripOneTrailingSemicolon(target.createTableQuery);
  if (statement === '') {
    throw new AdapterError('E_QUERY', `no definition returned for "${schema}"."${object.name}"`);
  }

  const checkRows = catalog.listCheckConstraints(target.createTableQuery);
  const constraints = checkRows.map(toConstraintMeta);

  const notes = [
    'A MergeTree PRIMARY KEY is a sparse index, not a uniqueness constraint — see Table properties.',
    'ClickHouse has no foreign keys.',
  ];

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
    sections: [buildTableSection(target)],
    generatedAt: new Date().toISOString(),
  };
}
