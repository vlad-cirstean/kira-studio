/**
 * `git status --porcelain=v2 --branch -z` (§4.4), as a discriminated union of its five record
 * kinds plus the `#` branch header. `UnmergedEntry` — the `u` record — is defined in
 * `conflict.ts` instead of here, since it is exactly the shape §7.5/§7.6's conflict handling
 * needs and this avoids a second, divergent definition later.
 */
import type { UnmergedEntry } from "./conflict.ts";

/** X or Y position of the XY status code. `.` means unmodified in that position. */
export type FileStatusCode = "." | "M" | "T" | "A" | "D" | "R" | "C" | "U";

export interface StatusBranchInfo {
  /** Undefined for an unborn branch (`git init` with no commits yet). */
  readonly oid: string | undefined;
  readonly head: { readonly kind: "branch"; readonly name: string } | { readonly kind: "detached" };
  readonly upstream: string | undefined;
  readonly ahead: number | undefined;
  readonly behind: number | undefined;
}

interface StatusEntryBase {
  readonly staged: FileStatusCode;
  readonly unstaged: FileStatusCode;
  /** Raw 4-char submodule state field (e.g. `N...`, `S.C.`); no deeper modelling in P1. */
  readonly submodule: string;
  readonly path: string;
}

export interface OrdinaryStatusEntry extends StatusEntryBase {
  readonly kind: "ordinary";
  readonly headMode: string;
  readonly indexMode: string;
  readonly worktreeMode: string;
  readonly headObjectId: string;
  readonly indexObjectId: string;
}

export interface RenamedStatusEntry extends StatusEntryBase {
  readonly kind: "renamed";
  readonly renameOrCopy: "rename" | "copy";
  readonly similarity: number;
  readonly headMode: string;
  readonly indexMode: string;
  readonly worktreeMode: string;
  readonly headObjectId: string;
  readonly indexObjectId: string;
  readonly originalPath: string;
}

export interface UntrackedStatusEntry {
  readonly kind: "untracked";
  readonly path: string;
}

export interface IgnoredStatusEntry {
  readonly kind: "ignored";
  readonly path: string;
}

export type StatusEntry =
  | OrdinaryStatusEntry
  | RenamedStatusEntry
  | UnmergedEntry
  | UntrackedStatusEntry
  | IgnoredStatusEntry;

export interface StatusResult {
  readonly branch: StatusBranchInfo;
  readonly entries: readonly StatusEntry[];
}
