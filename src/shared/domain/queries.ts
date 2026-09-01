import { z } from 'zod';

export type SortDirection = 'asc' | 'desc';
export const sortDirectionSchema = z.enum(['asc', 'desc']);

/**
 * §8.5's two sort editors, one state (D6). Clicking a grid header produces the structured
 * form and mirrors its equivalent string into the `ORDER BY` box; typing in the box switches
 * to the text form and clears the header indicators. Only the structured form is machine
 * readable enough to drive keyset pagination (D7) — a `text` sort is always `offset`.
 */
export const sortSpecSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('structured'),
    terms: z.array(z.object({ column: z.string(), direction: sortDirectionSchema })),
  }),
  z.object({
    kind: z.literal('text'),
    text: z.string().max(4096),
  }),
]);
export type SortSpec = z.infer<typeof sortSpecSchema>;

export const filterBodySchema = z.object({
  where: z.string().nullable(),
  orderBy: sortSpecSchema.nullable(),
});
export type FilterBody = z.infer<typeof filterBodySchema>;

// §8.14: "Console contents are saved to saved_queries" — just the script text, no result state.
export const consoleBodySchema = z.object({
  text: z.string(),
});
export type ConsoleBody = z.infer<typeof consoleBodySchema>;

const savedQueryBase = {
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  name: z.string().trim().min(1).max(120),
  pinned: z.boolean(),
  createdAt: z.string(),
  usedAt: z.string().nullable(),
};

export const savedQuerySchema = z.discriminatedUnion('kind', [
  z.object({ ...savedQueryBase, kind: z.literal('filter'), body: filterBodySchema }),
  z.object({ ...savedQueryBase, kind: z.literal('console'), body: consoleBodySchema }),
]);
export type SavedQuery = z.infer<typeof savedQuerySchema>;
export type SavedFilterQuery = Extract<SavedQuery, { kind: 'filter' }>;
export type SavedConsoleQuery = Extract<SavedQuery, { kind: 'console' }>;

export const filterHistoryEntrySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  where: z.string().nullable(),
  orderBy: sortSpecSchema.nullable(),
  usedAt: z.string(),
});
export type FilterHistoryEntry = z.infer<typeof filterHistoryEntrySchema>;
