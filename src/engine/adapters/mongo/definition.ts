import { EJSON } from 'bson';
import type { Db } from 'mongodb';
import type { DocumentSchemaMeta, ObjectDefinition } from '../../../shared/domain/definition';
import { encodePath, type NodePath } from '../../../shared/domain/tree';
import { collectionOptions } from './catalog';

const NO_OPTIONS_NOTE =
  'This collection has no creation options set (no validator, no capped-collection settings, etc).';

// Relaxed mode is deliberate (P19 D12): strict EJSON would render a schema's `minimum: 5` as
// `{"$numberInt":"5"}` in a pane whose whole job is readability, and a $jsonSchema is plain JSON
// by construction, so nothing is lost by relaxing it.
function stringifyRelaxed(value: unknown): string {
  return EJSON.stringify(value, undefined, 2, { relaxed: true });
}

// `$jsonSchema` renders as the Validation section's field table; any other validator document
// (e.g. `{ age: { $gte: 18 } }`) is real and genuinely allowed by Mongo — it renders as read-only
// JSON instead, never as an empty table pretending the schema fit a shape it doesn't have.
function buildDocumentSchema(
  validator: unknown,
  validationLevel: unknown,
  validationAction: unknown,
): DocumentSchemaMeta {
  const level = typeof validationLevel === 'string' ? validationLevel : null;
  const action = typeof validationAction === 'string' ? validationAction : null;
  if (typeof validator !== 'object' || validator === null) {
    return {
      validator: null,
      isJsonSchema: false,
      validationLevel: level,
      validationAction: action,
    };
  }
  const obj = validator as Record<string, unknown>;
  if ('$jsonSchema' in obj) {
    return {
      validator: stringifyRelaxed(obj.$jsonSchema),
      isJsonSchema: true,
      validationLevel: level,
      validationAction: action,
    };
  }
  return {
    validator: stringifyRelaxed(obj),
    isJsonSchema: false,
    validationLevel: level,
    validationAction: action,
  };
}

export async function buildDefinition(
  db: Db,
  segments: NodePath['segments'],
  databaseName: string,
  collection: string,
): Promise<ObjectDefinition> {
  const options = await collectionOptions(db, collection);
  const hasOptions = options !== undefined && Object.keys(options).length > 0;

  return {
    path: encodePath(segments),
    kind: 'collection',
    qualifiedName: `${databaseName}.${collection}`,
    language: 'json',
    statements: [hasOptions ? stringifyRelaxed(options) : '{}'],
    origin: 'server',
    notes: hasOptions ? [] : [NO_OPTIONS_NOTE],
    constraints: [],
    documentSchema: buildDocumentSchema(
      options?.validator,
      options?.validationLevel,
      options?.validationAction,
    ),
    sections: [],
    generatedAt: new Date().toISOString(),
  };
}
