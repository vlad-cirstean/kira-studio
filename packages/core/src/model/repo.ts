/**
 * Repository identity, as resolved by `packages/git`'s discovery (§4.2) from a single
 * `rev-parse --show-toplevel --git-dir --git-common-dir --is-bare-repository` call plus HEAD
 * resolution.
 */
export type HeadState =
  | { readonly kind: "branch"; readonly name: string }
  | { readonly kind: "detached"; readonly sha: string }
  /** A repo with no commits yet — `git init` and nothing else. Not an edge case to special-case later. */
  | { readonly kind: "unborn"; readonly name: string };

export interface RepoIdentity {
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly isBare: boolean;
  /** `gitDir !== commonDir` (D12) — detection is a comparison already made by this call. */
  readonly isLinkedWorktree: boolean;
  readonly head: HeadState;
}
