import type { NodePath } from './tree';

/**
 * One `execute()` batch (§8.14, P5.5 D-plan): `path` binds the batch to a connection and,
 * optionally, a default database/schema; `statements` is the pre-split list from
 * `sql-split.ts` — one call covers both "Run statement" (a one-element array) and "Run all".
 */
export interface ConsoleRequest {
  path: NodePath;
  statements: string[];
}

// P18 addendum D21: the ten shell methods `mongo/console.ts` dispatches — shared with the
// renderer's Mongo console completion source so the popup can never offer a method the parser
// rejects (the two would drift as two separate lists otherwise).
export const MONGO_CONSOLE_METHODS: readonly string[] = [
  'find',
  'findOne',
  'insertOne',
  'insertMany',
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'countDocuments',
  'aggregate',
];
