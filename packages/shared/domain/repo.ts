import { z } from 'zod';

// C5 §3.2: a repo entry's own wire shape — a parallel list to ConnectionSummary, never an
// extension of it (§3.1's Grounding: a repository needs none of that schema's sixteen fields but
// `name`). Mirrors bridge/coderepos.go's RepoSummary field-for-field.
export const repoSummarySchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string().min(1).max(120),
  root: z.string(),
  repoId: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
});
export type RepoSummary = z.infer<typeof repoSummarySchema>;

// bridge.CodeWorkspaceService.ImportRepo's own result — a plain RepoSummary today (no import-time
// warning to surface), kept as its own named type so a later phase can widen it without touching
// every call site's return type.
export const repoImportResultSchema = repoSummarySchema;
export type RepoImportResult = RepoSummary;

// C5 §7.1: one `git status --porcelain=v2` snapshot taken alongside the listing, collapsed to the
// four-value glyph the tree renders — 'M' modified, 'A' added, 'D' deleted, '?' untracked. A path
// absent from `status` is unchanged.
export const fileStatusCodeSchema = /*#__PURE__*/ z.enum(['M', 'A', 'D', '?']);
export type FileStatusCode = z.infer<typeof fileStatusCodeSchema>;

export const fileListingSchema = /*#__PURE__*/ z.object({
  paths: z.array(z.string()),
  status: /*#__PURE__*/ z.record(z.string(), fileStatusCodeSchema),
  // §7.1: an honest cap on a single IPC payload (200,000 paths) — true means the tree is showing
  // a prefix of the repository, not the whole thing.
  truncated: z.boolean(),
});
export type FileListing = z.infer<typeof fileListingSchema>;

// C5 §8.1: mirrors the git contract's own `file.read` result shape (found/tooLarge, packages/
// git-ipc/src/contract.ts) rather than inventing one, plus `missing` (a path git listed that no
// longer exists on disk) and `language` (this app's own id, §9.4 — resolved from the extension
// only, never sniffed; the binary check is the one place this phase *does* sniff bytes, §8.1).
export const fileContentSchema = /*#__PURE__*/ z.object({
  kind: /*#__PURE__*/ z.enum(['found', 'binary', 'tooLarge', 'missing']),
  text: z.string(),
  bytes: z.number(),
  limitBytes: z.number(),
  language: z.string(),
});
export type FileContent = z.infer<typeof fileContentSchema>;
