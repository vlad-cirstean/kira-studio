import { z } from 'zod';

export const filterNodeKindSchema = z.enum(['database', 'schema', 'table']);
export type FilterNodeKind = z.infer<typeof filterNodeKindSchema>;

export const filterActionSchema = z.enum(['hide', 'show']);
export type FilterAction = z.infer<typeof filterActionSchema>;

export const connectionFilterInputSchema = z.object({
  nodeKind: filterNodeKindSchema,
  pattern: z.string(),
  isRegex: z.boolean(),
  action: filterActionSchema,
});
export type ConnectionFilterInput = z.infer<typeof connectionFilterInputSchema>;

export const connectionFilterSchema = connectionFilterInputSchema.extend({
  id: z.string(),
  connectionId: z.string(),
});
export type ConnectionFilter = z.infer<typeof connectionFilterSchema>;
