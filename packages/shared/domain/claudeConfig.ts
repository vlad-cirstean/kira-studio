import { z } from 'zod';

// P233: bridge MemoryService/DbMcpService ClaudeLegacy and RemoveClaudeLegacy wire shapes. Neither
// app writes the user's Claude Code config; these only list and remove entries earlier versions
// registered. summary is a command or URL, never a credential.
export const claudeLegacyStatusSchema = /*#__PURE__*/ z.object({
  file: z.string(),
  entries: z.array(z.object({ name: z.string(), summary: z.string() })),
});
export type ClaudeLegacyStatus = z.infer<typeof claudeLegacyStatusSchema>;

export const claudeLegacyCleanupSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum(['removed', 'nothing', 'notFound', 'failed']),
  removed: z.array(z.string()),
  remaining: z.array(z.string()),
  backupPath: z.string(),
  detail: z.string(),
  commands: z.array(z.string()),
});
export type ClaudeLegacyCleanup = z.infer<typeof claudeLegacyCleanupSchema>;
