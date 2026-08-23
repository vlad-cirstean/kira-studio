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
