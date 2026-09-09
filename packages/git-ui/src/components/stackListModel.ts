/**
 * G26 D3/F12/F13/F14 — `StackList.vue`'s pure half: the per-row display model (PR badge/track text
 * reused VERBATIM from `PrState.byBranch`/`RefRow`, never re-derived), the stale chip's text, and
 * `parentOf`/`childOf` for `alt+up`/`alt+down` stack navigation. `ClassifyRestack` itself is never
 * ported here (see `contract.ts`'s own doc comment on the nine G26 wire types) — this file only
 * ever presents whatever `stack.list`/`preflight.restack` already returned.
 */
import type {
  PrRecord,
  RestackPreflight,
  StackBranch,
  StackListResult,
  StackSummary,
} from '@kira/git-ipc';
import { formatTrack } from './refListModel.ts';

/** One renderable row of the stack section — depth carries the indent (D3's own pre-order,
 *  bottom-to-top shape; the template applies it directly, `padding-left: depth * <unit>`, no
 *  separate "indent model" needed beyond this field). */
export interface StackRow {
  readonly name: string;
  readonly parent: string;
  readonly depth: number;
  readonly isHead: boolean;
  readonly stale: boolean;
  /** e.g. "1 commit behind" / "3 commits behind" — `undefined` when not stale. */
  readonly staleText: string | undefined;
  /** e.g. "1 commit" / "3 commits" — this branch's own commits since its base. */
  readonly aheadText: string;
  readonly checkedOutIn: string | undefined;
  readonly trackText: string | undefined;
  readonly pr: PrRecord | undefined;
  readonly isOrphan: boolean;
  /** Set only for an orphan row — the one-line remedy `StackList.vue`'s own orphan section shows. */
  readonly orphanReason: string | undefined;
}

export function staleChipText(branch: StackBranch): string | undefined {
  if (branch.state !== 'needsRestack') return undefined;
  return branch.behind === 1 ? '1 commit behind' : `${branch.behind} commits behind`;
}

export function aheadText(branch: StackBranch): string {
  return branch.ahead === 1 ? '1 commit' : `${branch.ahead} commits`;
}

function baseRow(
  branch: StackBranch,
  byBranch: ReadonlyMap<string, PrRecord>,
): Omit<StackRow, 'depth' | 'isOrphan' | 'orphanReason'> {
  return {
    name: branch.name,
    parent: branch.parent,
    isHead: branch.isHead,
    stale: branch.state === 'needsRestack',
    staleText: staleChipText(branch),
    aheadText: aheadText(branch),
    checkedOutIn: branch.checkedOutIn,
    trackText: formatTrack(branch.track),
    pr: byBranch.get(branch.name),
  };
}

/** `StackList.vue`'s own per-stack row set, pre-order bottom-to-top (D3's own ordering, passed
 *  through unchanged) — `pr` is `pickBestPr`-ready data, not a rendered badge (unlike
 *  `buildPrBadge`'s own DOM-building shape, which is `CommitGrid`'s canvas-row concern, not a
 *  plain Vue template's). */
export function buildStackRows(
  summary: StackSummary,
  byBranch: ReadonlyMap<string, PrRecord>,
): StackRow[] {
  return summary.branches.map((branch) => ({
    ...baseRow(branch, byBranch),
    depth: branch.depth,
    isOrphan: false,
    orphanReason: undefined,
  }));
}

/** The orphans section's own row set (D3: "never silently dropped, always surfaced with a
 *  remedy") — always depth 0 (an orphan has no tree position), `orphanReason` names the recorded
 *  (but unresolvable) parent so the row explains itself without a second lookup. */
export function buildOrphanRows(
  orphans: readonly StackBranch[],
  byBranch: ReadonlyMap<string, PrRecord>,
): StackRow[] {
  return orphans.map((branch) => ({
    ...baseRow(branch, byBranch),
    depth: 0,
    isOrphan: true,
    orphanReason:
      branch.parent === ''
        ? 'this branch sits in a cycle'
        : `parent "${branch.parent}" no longer exists`,
  }));
}

/** `pickBestPr`'s own one-line badge text, e.g. `"#123"` — `StackList.vue`'s own row badge;
 *  `undefined` when the row has no known PR (F13's "render nothing" rule). */
export function prBadgeLabel(pr: PrRecord | undefined): string | undefined {
  if (pr === undefined) return undefined;
  return `#${pr.number}`;
}

/** F14: a row needs a force-push after a restack when its own branch name appears in the
 *  preflight's `needsForcePush` list. `preflight` is `undefined` before the dialog has loaded one
 *  (e.g. the plain list view, which never fetches a preflight at all) — always `false` then. */
export function rowNeedsForcePush(
  preflight: RestackPreflight | undefined,
  branch: string,
): boolean {
  return preflight?.needsForcePush.includes(branch) ?? false;
}

// ---------------------------------------------------------------------------------------
// Navigation (D13/§7.3): alt+up/alt+down and the row menu's "Go to parent/child branch".
// ---------------------------------------------------------------------------------------

/** The recorded parent of `branch`, wherever it sits in the whole forest (every stack, D3's own
 *  forest model) — `undefined` at the top of a walk (the branch is not itself a stack member, or
 *  is a cycle-orphan whose own parent is nothing worth naming): navigation STOPS there rather than
 *  wrapping back to a leaf, the same "no cyclic wrap" behaviour `childOf` mirrors below. */
export function parentOf(result: StackListResult, branch: string): string | undefined {
  for (const stack of result.stacks) {
    const row = stack.branches.find((b) => b.name === branch);
    if (row !== undefined) return row.parent;
  }
  for (const orphan of result.orphans) {
    if (orphan.name === branch) return orphan.parent === '' ? undefined : orphan.parent;
  }
  return undefined;
}

/** The FIRST child of `branch` in pre-order (D3's own sorted-name sibling order at a fork) —
 *  `undefined` at a leaf: navigation stops rather than wrapping back to the base, the same
 *  "an end is an end" behaviour `parentOf` establishes at the other end of the stack. */
export function childOf(result: StackListResult, branch: string): string | undefined {
  for (const stack of result.stacks) {
    const child = stack.branches.find((b) => b.parent === branch);
    if (child !== undefined) return child.name;
  }
  return undefined;
}
