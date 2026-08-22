/**
 * §4.2's capability probe: two caches, keyed differently because they answer different
 * questions. Per-binary capabilities (does this git support X) are a version comparison
 * today, not a spawn — deriving `mergeTreeWriteTree` from the version we already resolved is
 * free; spawning `merge-tree` just to find out whether it exists would cost a process per
 * repo open for information the 2.38 floor already gives us. Per-repo capabilities (does
 * *this* repo have a commit-graph, is *this* worktree sparse) are real repository facts that
 * can only change when something writes to the repo, hence keyed by the driver's own
 * `generation` counter rather than time.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RepoIdentity } from "@kira-version/core";
import { compareVersions, type GitVersion } from "./discovery.ts";
import type { GitDriver, GitRead } from "./driver.ts";

export interface GitCapabilities {
  /** `merge-tree --write-tree` (2.38) — conflict prediction without touching the worktree. */
  readonly mergeTreeWriteTree: boolean;
  /** A `commit-graph` file, and fast topological walks when one is present (2.24). */
  readonly commitGraph: boolean;
  /** Sparse worktrees, which change what "dirty" means (2.25). */
  readonly sparseCheckout: boolean;
}

// All implied `true` by the 2.38 floor today. Kept as real version comparisons — not
// hardcoded `true` — because the floor moves over time (§4.2) and a capability that is a
// comparison today is one that a future, higher floor doesn't need to touch to add a fourth.
const FLOORS: { readonly [K in keyof GitCapabilities]: GitVersion } = {
  mergeTreeWriteTree: { major: 2, minor: 38, patch: 0, raw: "2.38.0" },
  commitGraph: { major: 2, minor: 24, patch: 0, raw: "2.24.0" },
  sparseCheckout: { major: 2, minor: 25, patch: 0, raw: "2.25.0" },
};

export function capabilitiesForVersion(version: GitVersion): GitCapabilities {
  return {
    mergeTreeWriteTree: compareVersions(version, FLOORS.mergeTreeWriteTree) >= 0,
    commitGraph: compareVersions(version, FLOORS.commitGraph) >= 0,
    sparseCheckout: compareVersions(version, FLOORS.sparseCheckout) >= 0,
  };
}

export interface RepoCapabilities {
  /** A `commit-graph` file exists for this repo — read from the *common* dir, not the git
   *  dir, or every linked worktree would report "no graph" despite sharing one. */
  readonly hasCommitGraph: boolean;
  readonly isSparseCheckout: boolean;
  /** Carried through from `RepoIdentity`, not re-derived — D12's "detection is free at P1" is
   *  the `gitDir !== commonDir` comparison identity already made. */
  readonly isLinkedWorktree: boolean;
}

function commitGraphPresent(commonDir: string): boolean {
  return (
    existsSync(join(commonDir, "objects", "info", "commit-graph")) ||
    existsSync(join(commonDir, "objects", "info", "commit-graphs", "commit-graph-chain"))
  );
}

async function collectRead(read: GitRead): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of read.bytes) {
    chunks.push(chunk);
    total += chunk.length;
  }
  await read.done;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** `git config --get` is a pure read (never mutates), so it goes through `driver.read()` —
 *  `driver.write()` would serialize it behind the write queue and, more importantly, would be
 *  the wrong claim about what this command does to the repository. */
async function sparseCheckoutEnabled(driver: GitDriver): Promise<boolean> {
  const bytes = await collectRead(
    driver.read(["config", "--type=bool", "--default=false", "core.sparseCheckout"]),
  );
  return new TextDecoder().decode(bytes).trim() === "true";
}

async function computeRepoCapabilities(
  driver: GitDriver,
  identity: RepoIdentity,
): Promise<RepoCapabilities> {
  return {
    hasCommitGraph: commitGraphPresent(identity.commonDir),
    isSparseCheckout: await sparseCheckoutEnabled(driver),
    isLinkedWorktree: identity.isLinkedWorktree,
  };
}

/**
 * Owns both caches for one process's lifetime. A fresh `CapabilitiesCache` per test (rather
 * than module-level state) keeps tests independent; production code holds one per repo
 * session.
 *
 * D21 is a hard rule enforced by what this file does *not* do: it only ever reads whether a
 * commit-graph exists, never writes one — no `commit-graph write`, not opportunistically, not
 * behind a default-off flag. Writing into someone's `.git` unasked is not ours to do, and the
 * cheapest guarantee that it never happens by accident is that the string `commit-graph
 * write` does not appear in this file.
 */
export class CapabilitiesCache {
  readonly #binary = new Map<string, GitCapabilities>();
  readonly #repo = new Map<string, RepoCapabilities>();

  binaryCapabilities(path: string, version: GitVersion): GitCapabilities {
    const key = `${path}@${version.raw}`;
    const cached = this.#binary.get(key);
    if (cached) return cached;
    const computed = capabilitiesForVersion(version);
    this.#binary.set(key, computed);
    return computed;
  }

  async repoCapabilities(driver: GitDriver, identity: RepoIdentity): Promise<RepoCapabilities> {
    const key = `${identity.root}@${driver.generation}`;
    const cached = this.#repo.get(key);
    if (cached) return cached;
    const computed = await computeRepoCapabilities(driver, identity);
    this.#repo.set(key, computed);
    return computed;
  }
}
