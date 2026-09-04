/** One entry of `git stash list` (§4.4). */
export interface StashEntry {
  /** The `N` in `stash@{N}`. */
  readonly index: number;
  /** The stash commit's own sha. */
  readonly sha: string;
  /** First parent — the commit the stash was taken on top of. */
  readonly baseSha: string;
  readonly message: string;
  readonly timestamp: number; // unix seconds
}
