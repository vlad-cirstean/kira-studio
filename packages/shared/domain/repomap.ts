import { z } from 'zod';

// C3 §7.4: the Code intelligence tab's own domain — bridge/repomap.go's RepoMapStatus/
// RepoMapInstallResult wire projections. Command carries the plaintext token exactly once (§0
// D8) — this is the one place in the whole system it ever appears at rest in the renderer, mirrored
// straight into a copyable text field, never persisted (no localStorage, no settings leaf).
export const repoMapStatusSchema = /*#__PURE__*/ z.object({
  running: z.boolean(),
  repo: z.string(),
  command: z.string(),
  claudeAvailable: z.boolean(),
  probed: z.array(z.string()),
  error: z.string(),
});
export type RepoMapStatus = z.infer<typeof repoMapStatusSchema>;

// "installed" | "notFound" | "installFailed" — mcpinstall.Install's own outcome vocabulary (§7.2):
// never a rejected call, always one of these three values.
export const repoMapInstallResultSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum(['installed', 'notFound', 'installFailed']),
  detail: z.string(),
  probed: z.array(z.string()),
});
export type RepoMapInstallResult = z.infer<typeof repoMapInstallResultSchema>;
