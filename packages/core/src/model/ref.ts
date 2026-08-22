/**
 * One row of `for-each-ref` (§4.4). Heads, remote-tracking branches and tags are one record
 * type discriminated on the refname prefix, because that is how `for-each-ref` returns them —
 * inventing three separate types would mean three near-identical parsers.
 */
export type RefKind = "branch" | "remoteBranch" | "tag";

export interface RefTrack {
  readonly ahead: number;
  readonly behind: number;
}

export interface RefRecord {
  /** Full refname, e.g. `refs/heads/main`. */
  readonly refname: string;
  readonly kind: RefKind;
  /** `refname` with its `refs/heads|remotes|tags/` prefix stripped, e.g. `origin/main`. */
  readonly shortName: string;
  readonly objectId: string;
  readonly objectType: "commit" | "tag" | "tree" | "blob";
  /** For an annotated tag: the commit it points at. Undefined for anything else. */
  readonly peeledObjectId: string | undefined;
  /** Full refname of the upstream, if this is a branch with one configured. */
  readonly upstream: string | undefined;
  readonly track: RefTrack | "gone" | undefined;
  readonly committerDate: number; // unix seconds
  readonly isHead: boolean;
}
