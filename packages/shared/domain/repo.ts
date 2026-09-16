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

// P78 §7.1/§7.2: one reference occurrence — codegraph.Site carried across the wire the same way
// navTargetSchema carries codegraph.Target. confidence is per-site, not per-result: an included
// site can come from an Exact/Scoped group or a singleton RepoWide one, materially different
// evidence a caller should be able to tell apart.
export const refSiteSchema = /*#__PURE__*/ z.object({
  path: z.string(),
  language: z.string(),
  kind: z.string(),
  name: z.string(),
  enclosing: z.string(),
  confidence: /*#__PURE__*/ z.enum(['exact', 'scoped', 'repoWide']),
  startLine: z.number(),
  startColumn: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
});
export type RefSite = z.infer<typeof refSiteSchema>;

// P78 §7.2: find-references' own wire shape — status follows navResultSchema's own convention;
// total/truncated/unattributed carry through even when sites is empty (every occurrence
// unattributed, say), since §7.3's status readout needs them regardless.
export const refResultSchema = /*#__PURE__*/ z.object({
  status: /*#__PURE__*/ z.enum(['ready', 'indexing', 'unavailable']),
  name: z.string(),
  sites: z.array(refSiteSchema),
  total: z.number(),
  truncated: z.boolean(),
  unattributed: z.number(),
});
export type RefResult = z.infer<typeof refResultSchema>;

// C7 §3.1: a repository-wide search request — Monaco's own find-widget vocabulary (case/whole-word/
// regex), so the panel's own options read the same as the in-file find widget (D13).
export const searchRequestSchema = /*#__PURE__*/ z.object({
  query: z.string(),
  regex: z.boolean(),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// C7 §3.1/D6: one match within one file. line/column/endColumn are Monaco's own 1-based line and
// 1-based UTF-16 column (the identical rules internal/codeworkspace/textpos.go's LineIndex uses).
// preview is the line's own text (EOL stripped, possibly windowed, §3.5) with
// previewMatchStart/End as UTF-16 offsets *into preview*, so the renderer highlights without
// re-deriving anything; truncatedStart/End say which side (if any) was windowed away — the string
// itself never carries an ellipsis, so a copied preview is always real file text.
export const searchMatchSchema = /*#__PURE__*/ z.object({
  line: z.number(),
  column: z.number(),
  endColumn: z.number(),
  preview: z.string(),
  previewMatchStart: z.number(),
  previewMatchEnd: z.number(),
  truncatedStart: z.boolean(),
  truncatedEnd: z.boolean(),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

// C7 §3.1: one file's own group of matches, streamed as codeworkspace.Search finds them.
// truncated means this file alone hit MaxMatchesPerFile.
export const fileMatchesSchema = /*#__PURE__*/ z.object({
  path: z.string(),
  matches: z.array(searchMatchSchema),
  truncated: z.boolean(),
});
export type FileMatches = z.infer<typeof fileMatchesSchema>;

// C7 §3.1: one search run's own summary, reported in the panel's status line (D4: the skip count
// is surfaced, never silent) — truncated here means the *whole run* hit MaxSearchMatches and
// stopped early, distinct from a single FileMatches' own per-file truncated flag.
export const searchStatsSchema = /*#__PURE__*/ z.object({
  filesScanned: z.number(),
  filesMatched: z.number(),
  filesSkipped: z.number(),
  matches: z.number(),
  truncated: z.boolean(),
});
export type SearchStats = z.infer<typeof searchStatsSchema>;

// C7 D7: ChannelCodeSearch's own payload — one coalesced batch of file groups. seq is the index of
// the first file group in this batch (the renderer merges by path, not by seq, but the field stays
// for the same future-reviewer-detects-a-gap reason GrpcCallEvent's own seq exists);
// stats/error are set only on the terminal event (done: true), which always fires exactly once,
// even with nothing pending and even on cancel.
export const codeSearchEventSchema = /*#__PURE__*/ z.object({
  searchId: z.string(),
  seq: z.number(),
  files: z.array(fileMatchesSchema),
  done: z.boolean(),
  stats: searchStatsSchema.nullish(),
  error: /*#__PURE__*/ z.object({ code: z.string(), message: z.string() }).nullish(),
});
export type CodeSearchEvent = z.infer<typeof codeSearchEventSchema>;
