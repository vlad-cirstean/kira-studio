import { z } from 'zod';

// Saved filters + history, one store (D14): history and saved are the SAME rows, distinguished by
// `name`. Empty `name` ⇒ history (pruned to the newest HISTORY_LIMIT per table); non-empty ⇒
// saved/pinned — naming *is* the pinning act. `kind` stays free for P5.5's console entries.

export const savedQueryKindSchema = z.enum(['filter']); // P5.5 adds 'console'
export type SavedQueryKind = z.infer<typeof savedQueryKindSchema>;

export const filterBodySchema = z.object({ where: z.string(), orderBy: z.string() });
export type FilterBody = z.infer<typeof filterBodySchema>;

export const savedQuerySchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  name: z.string(), // '' ⇒ history; non-empty ⇒ saved/pinned (D14)
  kind: savedQueryKindSchema,
  body: filterBodySchema, // stored as JSON text in `saved_queries.body`
  createdAt: z.string(),
  usedAt: z.string().nullable(),
});
export type SavedQuery = z.infer<typeof savedQuerySchema>;

export const HISTORY_LIMIT = 20;
