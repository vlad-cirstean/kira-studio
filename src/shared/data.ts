import { z } from 'zod';
import type { TabularPage } from './page';

// Read/count request contracts (P2 §3.2). These ARE Zod — they cross into SQL, so every field is
// bounded before the engine touches it. `ReadRequest` deliberately does not carry a structured sort:
// D17 made the ORDER BY text the single truth; a parallel structured field would be a second one.

export const sortDirectionSchema = z.enum(['asc', 'desc']);

export const pageCursorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offset'), offset: z.number().int().min(0) }),
  z.object({
    kind: z.literal('keyset'),
    token: z.string().max(8192),
    direction: z.enum(['next', 'prev']),
  }),
]);
export type PageCursor = z.infer<typeof pageCursorSchema>;

export const readRequestSchema = z.object({
  connectionId: z.string(),
  /** Encoded NodePath of a table/view/matview (P1 §3). */
  path: z.string(),
  /** Stamped onto op:start so the renderer can attribute the running op to a tab (D9). */
  tabId: z.string(),
  /** null ⇒ every column in catalog order (D18). */
  projection: z.array(z.string()).nullable(),
  /** Free-text WHERE body, no `WHERE` keyword. Empty ⇒ no predicate (D13). */
  where: z.string().max(20_000),
  /** Free-text ORDER BY body, no `ORDER BY` keyword. Empty ⇒ adapter default (D17). */
  orderBy: z.string().max(20_000),
  pageSize: z.number().int().min(1).max(20_000),
  cursor: pageCursorSchema,
  /** Bypass the L2 lookup and overwrite the entry (Refresh button, D26). */
  refresh: z.boolean().default(false),
  /** Fill L2 and return no payload (D21). */
  prefetch: z.boolean().default(false),
});
export type ReadRequest = z.infer<typeof readRequestSchema>;

export const countRequestSchema = z.object({
  connectionId: z.string(),
  path: z.string(),
  tabId: z.string(),
  where: z.string().max(20_000),
  mode: z.enum(['estimate', 'exact']),
  refresh: z.boolean().default(false),
});
export type CountRequest = z.infer<typeof countRequestSchema>;

/** `page` is null exactly when the request was a prefetch. */
export type ReadResult =
  | { delivered: true; page: TabularPage }
  | { delivered: false; rowCount: number; bytes: number };

export interface CountResult {
  value: number;
  exact: boolean;
  fromCache: boolean;
  at: string;
}
