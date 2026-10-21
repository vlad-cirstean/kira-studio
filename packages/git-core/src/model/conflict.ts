/**
 * The two conflict-shaped things: an unmerged working-tree entry (status v2's `u`
 * record) and the result of `git merge-tree --write-tree` — a conflict
 * prediction made without touching the worktree. This is the raw mechanism.
 */
import type { FileStatusCode } from './status.ts';

export interface UnmergedStage {
  readonly mode: string;
  readonly objectId: string;
}

export interface UnmergedEntry {
  readonly kind: 'unmerged';
  readonly staged: FileStatusCode;
  readonly unstaged: FileStatusCode;
  readonly submodule: string;
  /** Stage 1 — the common ancestor. */
  readonly base: UnmergedStage;
  /** Stage 2 — our side. */
  readonly ours: UnmergedStage;
  /** Stage 3 — their side. */
  readonly theirs: UnmergedStage;
  readonly worktreeMode: string;
  readonly path: string;
}

export type MergePrediction =
  | { readonly kind: 'clean'; readonly treeId: string; readonly messages: readonly string[] }
  | {
      readonly kind: 'conflicts';
      readonly paths: readonly string[];
      readonly messages: readonly string[];
    };
