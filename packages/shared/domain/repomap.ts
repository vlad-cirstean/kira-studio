import { z } from 'zod';

// P67d §7.1: the Code intelligence tab's own domain — bridge/repomap.go's RepoMapStatus/
// RepoMapRepoStatus/RepoMapInstallResult wire projections. Command carries the plaintext token
// exactly once (C3 §0 D8) — this is the one place in the whole system it ever appears at rest in
// the renderer, mirrored straight into a copyable text field, never persisted (no localStorage, no
// settings leaf).

// One imported repository's own MCP access row — the "Repository access" list's whole data source.
export const repoMapRepoStatusSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  root: z.string(),
  key: z.string(),
  enabled: z.boolean(),
  serving: z.boolean(),
  ready: z.boolean(),
  error: z.string(),
});
export type RepoMapRepoStatus = z.infer<typeof repoMapRepoStatusSchema>;

// url replaces the old single-repository `repo` field (P67d closes the toggle's cwd-scoping bug):
// one server now serves however many repositories are granted, so nothing renders a single
// repository's own root any more.
export const repoMapStatusSchema = /*#__PURE__*/ z.object({
  running: z.boolean(),
  url: z.string(),
  command: z.string(),
  claudeAvailable: z.boolean(),
  probed: z.array(z.string()),
  // M1 §6.2: the current token's own expiry, RFC 3339, "" when nothing is running or the record
  // has not yet been stamped by the 7-day-rotation retrofit. Without this the retrofit is a silent
  // trap — a registered client just starts getting 401s a week after upgrade with no visible cause.
  expiresAt: z.string(),
  error: z.string(),
  repos: z.array(repoMapRepoStatusSchema),
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
