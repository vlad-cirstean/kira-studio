/**
 * In-memory hand-built commit topologies for graph-layout unit tests (P2's W6-W9).
 * `generateRepo.ts` builds real repositories with real git, which is right for the pipeline's
 * integration tests and wrong here: it costs a process per commit, and it cannot express the
 * shapes that break lane assignment — a twelve-parent octopus, three unrelated roots, fifty
 * concurrent branches, a merge whose parents are 40,000 rows apart. This builder costs nothing
 * per commit and can express all of them directly.
 */
import { createHash } from 'node:crypto';
import type { CommitRecord } from '../src/model/commit';

const EPOCH_SECONDS = 1_700_000_000;
const STEP_SECONDS = 3600;
const AUTHOR_NAME = 'Kira Fixture';
const AUTHOR_EMAIL = 'fixture@kira-version.test';

export class TopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopologyError';
  }
}

/** Deterministic 40-hex sha from a commit's name, so a test can assert on identity without
 *  pinning a real sha and without needing to spawn git. */
function shaFor(name: string): string {
  return createHash('sha1').update(`topology-fixture:${name}`).digest('hex');
}

interface ParsedEntry {
  readonly name: string;
  readonly parents: readonly string[];
}

function parseEntry(spec: string, index: number): ParsedEntry {
  const colon = spec.indexOf(':');
  const name = (colon === -1 ? spec : spec.slice(0, colon)).trim();
  if (name.length === 0) {
    throw new TopologyError(`topology(): entry ${index} (${JSON.stringify(spec)}) has no name`);
  }
  const parents =
    colon === -1
      ? []
      : spec
          .slice(colon + 1)
          .split(',')
          .map((p) => p.trim())
          .filter((p) => p.length > 0);
  return { name, parents };
}

/**
 * Builds a topology from `"name"` / `"name:parent1,parent2"` entries, oldest-first — the order
 * a human writes a topology in. Every parent must name an entry that already appeared earlier
 * in `spec`; this is what makes a cycle structurally impossible rather than something detected
 * after the fact; a parent named before its own definition (a forward reference or a genuine
 * cycle) is rejected as "unknown parent name" for the same reason.
 *
 * Returns `CommitRecord[]` in **reverse topological order** — newest first, exactly as
 * `git log --topo-order` emits — which is simply `spec`'s order reversed, since building
 * oldest-first with parents-must-already-exist already guarantees every parent sits after its
 * children once reversed.
 */
export function topology(spec: readonly string[]): CommitRecord[] {
  const known = new Map<string, ParsedEntry>();
  const order: ParsedEntry[] = [];

  spec.forEach((raw, index) => {
    const entry = parseEntry(raw, index);
    if (known.has(entry.name)) {
      throw new TopologyError(`topology(): duplicate commit name ${JSON.stringify(entry.name)}`);
    }
    for (const parent of entry.parents) {
      if (!known.has(parent)) {
        throw new TopologyError(
          `topology(): entry ${JSON.stringify(entry.name)} names unknown parent ` +
            `${JSON.stringify(parent)} (parents must be defined earlier in the spec)`,
        );
      }
    }
    known.set(entry.name, entry);
    order.push(entry);
  });

  const records: CommitRecord[] = order.map((entry, index) => {
    const timestamp = EPOCH_SECONDS + index * STEP_SECONDS;
    const identity = { name: AUTHOR_NAME, email: AUTHOR_EMAIL, timestamp };
    return {
      sha: shaFor(entry.name),
      parents: entry.parents.map(shaFor),
      author: identity,
      committer: identity,
      subject: entry.name,
      decoration: [],
    };
  });

  return records.reverse();
}

/** `topology()`'s spec syntax, for callers that want to build one programmatically before
 *  handing it to `topology()`. */
export type TopologySpec = string;

/**
 * `branches` independent chains of `depthPerBranch` commits each, all forking from one shared
 * root and never merged back — every lane stays open to the end of the loaded range. Named
 * `fan-root`, `fan-{b}-{d}` (0-indexed).
 */
export function fan(branches: number, depthPerBranch: number): CommitRecord[] {
  const spec: TopologySpec[] = ['fan-root'];
  for (let b = 0; b < branches; b++) {
    let parent = 'fan-root';
    for (let d = 0; d < depthPerBranch; d++) {
      const name = `fan-${b}-${d}`;
      spec.push(`${name}:${parent}`);
      parent = name;
    }
  }
  return topology(spec);
}

/**
 * A base commit, `parents` sibling commits each forked directly from it, and one merge commit
 * with all of them as parents (in order) — an N-parent octopus merge.
 */
export function octopusOf(parents: number): CommitRecord[] {
  if (parents < 2) {
    throw new TopologyError(`octopusOf(${parents}): an octopus merge needs at least 2 parents`);
  }
  const spec: TopologySpec[] = ['octopus-base'];
  const tips: string[] = [];
  for (let i = 0; i < parents; i++) {
    const name = `octopus-tip-${i}`;
    spec.push(`${name}:octopus-base`);
    tips.push(name);
  }
  spec.push(`octopus-merge:${tips.join(',')}`);
  return topology(spec);
}
