import { z } from 'zod';
import { nodeKindSchema } from './tree';

/** Where the text came from. 'server' is the engine's own definition, byte for byte. */
export const definitionOriginSchema = /*#__PURE__*/ z.enum(['server', 'composed']);
export type DefinitionOrigin = z.infer<typeof definitionOriginSchema>;

/** How the Source pane renders `statements`, and how definitionText() joins them.
 *  'sql' -> one statement per entry, ';'-terminated. 'json' -> one document, no separator. */
export const definitionLanguageSchema = /*#__PURE__*/ z.enum(['sql', 'json']);
export type DefinitionLanguage = z.infer<typeof definitionLanguageSchema>;

export const constraintMetaSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  type: /*#__PURE__*/ z.enum(['primaryKey', 'unique', 'foreignKey', 'check', 'exclusion']),
  /** The engine's own text: pg_get_constraintdef(), or MariaDB's CHECK_CLAUSE / key column list.
   *  Rendered verbatim — never re-composed here (P19 D11). */
  definition: z.string(),
});
export type ConstraintMeta = z.infer<typeof constraintMetaSchema>;

/** Structure a document engine has and the SQL-shaped ObjectMeta has no room for. Null for
 *  every SQL engine, and for a Mongo collection this is the *only* new data on the wire — its
 *  indexes already arrive through describe() (P19 realities #10). */
export const documentSchemaMetaSchema = /*#__PURE__*/ z.object({
  /** EJSON (relaxed, 2-space) — the `$jsonSchema` sub-document when the validator has one, else
   *  the whole validator document verbatim. Null when no validator is set. */
  validator: z.string().nullable(),
  /** True when `validator` is the $jsonSchema sub-document, i.e. renderable as a field table. */
  isJsonSchema: z.boolean(),
  validationLevel: z.string().nullable(), // 'off' | 'strict' | 'moderate'
  validationAction: z.string().nullable(), // 'error' | 'warn'
});
export type DocumentSchemaMeta = z.infer<typeof documentSchemaMetaSchema>;

/** P23 D6: a named block of name/value facts about an object that is neither SQL text nor
 *  ObjectMeta — a Kafka topic's partitions and its non-default config, a consumer group's members,
 *  an SQS queue's attributes. Rendered by views/definition/PropertiesSection.vue, one section per
 *  entry, in the order the adapter returned them. [] for postgres/mariadb/mongo. */
export const definitionSectionSchema = /*#__PURE__*/ z.object({
  title: z.string(),
  rows: /*#__PURE__*/ z.array(
    /*#__PURE__*/ z.object({
      name: z.string(),
      value: z.string(),
      /** Muted secondary text on the same row — a partition's replicas/ISR, a config's source. */
      detail: z.string().nullable(),
    }),
  ),
});
export type DefinitionSection = z.infer<typeof definitionSectionSchema>;

export const objectDefinitionSchema = /*#__PURE__*/ z.object({
  /** Encoded NodePath of the object — the L1 cache key's second component and the tab's path. */
  path: z.string(),
  kind: nodeKindSchema,
  /** Display form, unquoted, identical to ObjectMeta.qualifiedName: 'app.order_items'. */
  qualifiedName: z.string(),
  language: definitionLanguageSchema,
  /** Ordered, each without a trailing semicolon. Never empty. */
  statements: /*#__PURE__*/ z.array(z.string()).min(1),
  origin: definitionOriginSchema,
  /** One short sentence per caveat; [] when there is nothing to say. */
  notes: /*#__PURE__*/ z.array(z.string()),
  /** [] where the engine has none (P19 D11) — never omitted. */
  constraints: /*#__PURE__*/ z.array(constraintMetaSchema),
  /** Null for every SQL engine (P19 D12). */
  documentSchema: documentSchemaMetaSchema.nullable(),
  /** [] for postgres/mariadb/mongo (P23 D6). `.default([])` so a definition cached before P23
   *  still parses — no cache bump, no migration, no forced refetch. */
  sections: /*#__PURE__*/ z.array(definitionSectionSchema).default([]),
  /** ISO-8601, stamped by the adapter when the text was produced. */
  generatedAt: z.string(),
});
export type ObjectDefinition = z.infer<typeof objectDefinitionSchema>;

/** The one definition of "the Source pane's document". Used by the view, and by the DB specs'
 *  round trip. ';'-joins for 'sql' (each statement its own line), '\n\n' for 'json' (a single
 *  document has no per-statement separator to add). */
export function definitionText(def: ObjectDefinition): string {
  if (def.language === 'json') return def.statements.join('\n\n');
  return def.statements.map((s) => `${s};`).join('\n\n');
}
