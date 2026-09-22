import { type TabScope, tabRecordBase, terminalTabStateSchema } from '@shared/domain/tabs';
import { z } from 'zod';

// P103 Part 2 (§5.1): Kira Space's own tab-kind vocabulary, split out of the old shared
// `packages/shared/domain/tabs.ts` — 5 kinds, `terminal` the one genuinely shared with Kira
// Studio (its schema stays in the shared file). Absorbs the old `SpaceTabKind` alias, now the
// vocabulary itself rather than a narrower view onto a wider shared one.
// Not consumed outside this file — every other module wants the derived `SpaceTabKind` type
// (below) or the RENDERABLE_TAB_KINDS/TAB_KIND_MODE constants, never the schema itself.
const spaceTabKindSchema = /*#__PURE__*/ z.enum([
  'repo-graph',
  'repo-file',
  'repo-diff',
  'repo-multi-diff',
  'terminal',
]);
export type SpaceTabKind = z.infer<typeof spaceTabKindSchema>;

export const SPACE_RENDERABLE_TAB_KINDS: readonly SpaceTabKind[] = [
  'repo-graph',
  'repo-file',
  'repo-diff',
  'repo-multi-diff',
  'terminal',
];

export const SPACE_TAB_KIND_MODE: Record<SpaceTabKind, TabScope> = {
  'repo-graph': 'repo',
  'repo-file': 'repo',
  'repo-diff': 'repo',
  'repo-multi-diff': 'repo',
  terminal: 'repo',
};

// C5 §6.2: the permanently pinned, unclosable first tab every repo workspace reserves for the
// git graph. `viewState` holds git-ui's own `PersistedViewState` (version-6 shape) — a permissive
// passthrough rather than re-deriving that shape here; git-ui's own `parsePersistedViewState` is
// the sole validator. `reviewSession` is a second opaque blob of the same shape, the review
// sidebar's own "back to branch selection" resume point.
export const repoGraphTabStateSchema = /*#__PURE__*/ z.object({
  viewState: z.unknown().nullable().default(null),
  reviewSession: z.unknown().nullable().default(null),
});
export type RepoGraphTabState = z.infer<typeof repoGraphTabStateSchema>;

// C5 §9.3/§12: revealLine is the one thing worth remembering across a restore. P67c D12: source
// is the default for every file type this app opens, markdown included. P74 §7.3: non-null `rev`
// means this tab shows `path` at that revision, read-only, via `file.read` — not the worktree file.
export const repoFileTabStateSchema = /*#__PURE__*/ z.object({
  revealLine: z.number().int().min(1).nullable().default(null),
  markdownReading: z.boolean().default(false),
  rev: z.string().nullable().default(null),
});
export type RepoFileTabState = z.infer<typeof repoFileTabStateSchema>;

// C11 §7.5: a review diff's own target — which branch this review is against, that branch's tip
// at review-open time, and the left side's display label.
// Not consumed outside this file — every other module wants the derived `ReviewRef` type below.
const reviewRefSchema = /*#__PURE__*/ z.object({
  branch: z.string(),
  branchTip: z.string(),
  leftLabel: z.string(),
});
export type ReviewRef = z.infer<typeof reviewRefSchema>;

// C6 §8.1/D10: a diff tab's session state — both null (the default) is C6's own HEAD-vs-worktree
// comparison; a commit diff's view reads `left`/`right` as the two revisions. C11 §7.5: review
// turns on the gutter/comment-thread layer over the same left/right pair.
export const repoDiffTabStateSchema = /*#__PURE__*/ z.object({
  left: z.string().nullable().default(null),
  right: z.string().nullable().default(null),
  leftLabel: z.string().nullable().default(null),
  rightLabel: z.string().nullable().default(null),
  review: reviewRefSchema.nullable().default(null),
});
export type RepoDiffTabState = z.infer<typeof repoDiffTabStateSchema>;

// P92 item 5: one commit's whole changed-file set, in one tab (VS Code's multi-file diff).
// `files` is the commit's own file order, captured at open time.
export const repoMultiDiffTabStateSchema = /*#__PURE__*/ z.object({
  left: z.string(),
  right: z.string(),
  leftLabel: z.string(),
  rightLabel: z.string(),
  files: /*#__PURE__*/ z.array(z.string()).default([]),
  review: reviewRefSchema.nullable().default(null),
});
export type RepoMultiDiffTabState = z.infer<typeof repoMultiDiffTabStateSchema>;

// Not consumed outside this file — every other module wants the derived `TabRecord` type below.
const tabRecordSchema = /*#__PURE__*/ z.discriminatedUnion('kind', [
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-graph'),
    state: repoGraphTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-file'),
    state: repoFileTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-diff'),
    state: repoDiffTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('repo-multi-diff'),
    state: repoMultiDiffTabStateSchema,
  }),
  /*#__PURE__*/ z.object({
    ...tabRecordBase,
    kind: z.literal('terminal'),
    state: terminalTabStateSchema,
  }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
export type RepoGraphTabRecord = Extract<TabRecord, { kind: 'repo-graph' }>;
export type RepoFileTabRecord = Extract<TabRecord, { kind: 'repo-file' }>;
export type RepoDiffTabRecord = Extract<TabRecord, { kind: 'repo-diff' }>;
export type RepoMultiDiffTabRecord = Extract<TabRecord, { kind: 'repo-multi-diff' }>;
export type TerminalTabRecord = Extract<TabRecord, { kind: 'terminal' }>;

export function asRepoGraphTab(tab: TabRecord | null | undefined): RepoGraphTabRecord | null {
  return tab && tab.kind === 'repo-graph' ? tab : null;
}

export function asRepoFileTab(tab: TabRecord | null | undefined): RepoFileTabRecord | null {
  return tab && tab.kind === 'repo-file' ? tab : null;
}

export function asRepoDiffTab(tab: TabRecord | null | undefined): RepoDiffTabRecord | null {
  return tab && tab.kind === 'repo-diff' ? tab : null;
}

export function defaultRepoGraphTabState(): RepoGraphTabState {
  return { viewState: null, reviewSession: null };
}

export function defaultRepoFileTabState(
  revealLine: number | null = null,
  rev: string | null = null,
): RepoFileTabState {
  return { revealLine, markdownReading: false, rev };
}

/**
 * With no arguments, C6's own HEAD-vs-worktree comparison (every field null). C10's
 * `openRepoCommitDiffTab` is one caller that supplies the revision pair; C11's
 * `openRepoReviewDiffTab` (S8) is the one caller that also supplies `review`.
 */
export function defaultRepoDiffTabState(
  revision?: {
    left: string;
    right: string;
    leftLabel: string;
    rightLabel: string;
  },
  review?: { branch: string; branchTip: string; leftLabel: string },
): RepoDiffTabState {
  return {
    left: revision?.left ?? null,
    right: revision?.right ?? null,
    leftLabel: revision?.leftLabel ?? null,
    rightLabel: revision?.rightLabel ?? null,
    review: review ?? null,
  };
}

/** P92 item 5: `files` is captured at open time (the commit's own order) — the caller's job. */
export function defaultRepoMultiDiffTabState(
  files: string[],
  revision: { left: string; right: string; leftLabel: string; rightLabel: string },
  review?: ReviewRef,
): RepoMultiDiffTabState {
  return {
    left: revision.left,
    right: revision.right,
    leftLabel: revision.leftLabel,
    rightLabel: revision.rightLabel,
    files,
    review: review ?? null,
  };
}
