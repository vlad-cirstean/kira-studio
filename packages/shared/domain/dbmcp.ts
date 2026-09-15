import { z } from 'zod';

// M1 §6.2: the Database MCP section's own domain — bridge/dbmcp.go's DbMcpStatus/
// DbMcpInstallResult wire projections. Command carries the plaintext token exactly once, mirroring
// repomap.ts's own repoMapStatusSchema — this is the one place in the whole system it ever appears
// at rest in the renderer, never persisted (no localStorage, no settings leaf).
export const dbMcpStatusSchema = /*#__PURE__*/ z.object({
  running: z.boolean(),
  command: z.string(),
  claudeAvailable: z.boolean(),
  probed: z.array(z.string()),
  // The current token's own expiry, RFC 3339, "" when nothing is running or the record has not
  // yet been stamped.
  expiresAt: z.string(),
  error: z.string(),
});
export type DbMcpStatus = z.infer<typeof dbMcpStatusSchema>;

// "installed" | "notFound" | "installFailed" — mcpinstall.Install's own outcome vocabulary,
// mirroring repoMapInstallResultSchema's own.
export const dbMcpInstallResultSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum(['installed', 'notFound', 'installFailed']),
  detail: z.string(),
  probed: z.array(z.string()),
});
export type DbMcpInstallResult = z.infer<typeof dbMcpInstallResultSchema>;
