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

// C6 §5/D12: one side of a HEAD-vs-worktree diff — the same four-value classification
// fileContentSchema already uses for the worktree side, so the diff view reuses one vocabulary
// rather than inventing a second. No status field on the diff as a whole: the two sides already
// say what happened (HEAD missing means added, worktree missing means deleted, both present means
// modified).
export const diffSideSchema = /*#__PURE__*/ z.object({
  kind: /*#__PURE__*/ z.enum(['found', 'binary', 'tooLarge', 'missing']),
  text: z.string(),
  bytes: z.number(),
  limitBytes: z.number(),
});
export type DiffSide = z.infer<typeof diffSideSchema>;

export const diffContentSchema = /*#__PURE__*/ z.object({
  path: z.string(),
  language: z.string(),
  head: diffSideSchema,
  worktree: diffSideSchema,
});
export type DiffContent = z.infer<typeof diffContentSchema>;

// C6 §6/D2: one definition candidate — codegraph's own Rule/Confidence carried through untouched
// (internal/repomap/render.go's discipline: a repoWide guess must never read like a fact). The
// span is Monaco's own 1-based line / 1-based UTF-16 column already, ready to use as an IRange.
export const navTargetSchema = /*#__PURE__*/ z.object({
  path: z.string(),
  language: z.string(),
  kind: z.string(),
  name: z.string(),
  container: z.string(),
  rule: z.string(),
  confidence: /*#__PURE__*/ z.enum(['exact', 'scoped', 'repoWide']),
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
});
export type NavTarget = z.infer<typeof navTargetSchema>;

// C6 §6/D8: status is checked non-blocking on every call — 'indexing' while the initial sync is
// still running (never waited on), 'unavailable' when the file isn't in the index at all,
// otherwise 'ready' with zero or more targets.
export const navResultSchema = /*#__PURE__*/ z.object({
  status: /*#__PURE__*/ z.enum(['ready', 'indexing', 'unavailable']),
  name: z.string(),
  targets: z.array(navTargetSchema),
});
export type NavResult = z.infer<typeof navResultSchema>;
