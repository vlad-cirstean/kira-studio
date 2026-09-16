import { describe, expect, test } from 'bun:test';
import type { CommitRecord } from '@kira/git-core';
import { CommitStore } from '@kira/git-core';
import type {
  EventKey,
  EventPayload,
  GhStatus,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { PrState } from './pr.ts';

/** Same fake `Transport` shape `repoSettings.test.ts` already established — request() is scripted
 *  per call via `onRequest`, and `deferred` lets a test control exactly when each call's own
 *  promise resolves (needed for the stale-response test below). */
class FakeTransport implements Transport {
  onRequest: (method: RequestKey, params: unknown) => unknown = () => {
    throw new Error('unscripted request');
  };
  readonly calls: Array<{ method: RequestKey; params: unknown }> = [];
  #handlers = new Map<EventKey, Set<(payload: unknown) => void>>();

  request<K extends RequestKey>(method: K, params: ParamsOf<K>): Promise<ResultOf<K>> {
    this.calls.push({ method, params });
    return Promise.resolve(this.onRequest(method, params) as ResultOf<K>);
  }

  on<K extends EventKey>(method: K, handler: (payload: EventPayload<K>) => void): () => void {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    const wrapped = handler as (payload: unknown) => void;
    set.add(wrapped);
    return () => set?.delete(wrapped);
  }

  emit<K extends EventKey>(method: K, payload: EventPayload<K>): void {
    for (const handler of this.#handlers.get(method) ?? []) {
      handler(payload);
    }
  }

  stream<K extends StreamKey>(
    _method: K,
    _params: StreamParamsOf<K>,
    _onChunk: (chunk: StreamChunkOf<K>) => void,
  ): Promise<void> {
    return Promise.reject(new Error('not used by these tests'));
  }

  dispose(): void {}
}

function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const REPO = '/repos/a';

/** A deterministic 40-hex-char sha (`ShaTable`'s own width auto-detect needs a consistent
 *  length across every append) — `n` distinguishes rows, never meant to look like a real hash.
 *  `n` sits in the leading hex digits, not the trailing ones: `ShaTable`'s own index hashes each
 *  sha's first 4 bytes (`hashFirstFourBytes`), so padding `n` on the right would give every row
 *  in a large chain the same all-zero hash and turn every lookup into an O(n) linear probe. */
function sha(n: number): string {
  return n.toString(16).padStart(8, '0') + '0'.repeat(32);
}

function record(shaHex: string, parents: readonly string[]): CommitRecord {
  return {
    sha: shaHex,
    parents,
    author: { name: 'a', email: 'a@x.test', timestamp: 0 },
    committer: { name: 'a', email: 'a@x.test', timestamp: 0 },
    subject: 'c',
    decoration: [],
  };
}

/** A linear chain, tip first: `shas[0]` is the branch tip, `shas[i]`'s parent is `shas[i + 1]`,
 *  the last entry a root commit. Appended tip-first (the real loading order) so every parent but
 *  the last starts out unresolved — `CommitStore`'s own pending-parent resolution, exercised for
 *  free rather than assumed away by appending in some other order. */
function buildChain(length: number): { store: CommitStore; shas: string[] } {
  const store = new CommitStore();
  const shas = Array.from({ length }, (_, i) => sha(i));
  for (let i = 0; i < length; i++) {
    store.append(record(shas[i] as string, i + 1 < length ? [shas[i + 1] as string] : []));
  }
  return { store, shas };
}

describe('PrState — per-commit selection debounce', () => {
  test('selecting several shas within the debounce window issues exactly one request, for the last one', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.calls.length = 0; // setRepoId itself issues no request; keep the assertion focused.

    transport.onRequest = () => ({ kind: 'ok', prs: [] });
    pr.select('sha1');
    pr.select('sha2');
    pr.select('sha3');
    await tick(350);

    const resolveCalls = transport.calls.filter((c) => c.method === 'commit.resolvePr');
    expect(resolveCalls.length).toBe(1);
    expect(resolveCalls[0]?.params).toEqual({ repoId: REPO, sha: 'sha3' });
    pr.dispose();
  });
});

describe('PrState — stale-response drop', () => {
  test('an older selection’s response landing after a newer one is selected is dropped', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);

    let resolveFirst: ((v: unknown) => void) | undefined;
    transport.onRequest = (_method, params) => {
      const sha = (params as { sha: string }).sha;
      if (sha === 'sha-old') {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        kind: 'ok',
        prs: [
          {
            number: 2,
            title: 'new',
            url: 'u',
            state: 'open',
            headRef: 'b',
            headSha: sha,
            baseRef: 'main',
            updatedAt: 0,
          },
        ],
      });
    };

    pr.select('sha-old');
    await tick(350); // let the debounce fire and the request actually start (and hang).

    pr.select('sha-new');
    await tick(350); // sha-new's own request resolves immediately (a plain Promise.resolve).

    expect(pr.selected.value?.kind).toBe('ok');
    if (pr.selected.value?.kind === 'ok') {
      expect(pr.selected.value.prs[0]?.headSha).toBe('sha-new');
    }

    // Now let the stale sha-old response land — it must NOT overwrite sha-new's own result.
    resolveFirst?.({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 'old',
          url: 'u',
          state: 'open',
          headRef: 'b',
          headSha: 'sha-old',
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    await tick(10);

    expect(pr.selected.value?.kind).toBe('ok');
    if (pr.selected.value?.kind === 'ok') {
      expect(pr.selected.value.prs[0]?.headSha).toBe('sha-new');
    }
    pr.dispose();
  });
});

describe('PrState — refsChanged clears everything', () => {
  test('a repo.changed refsChanged event empties bySha/byBranch/selected/status and bumps generation', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);

    transport.onRequest = () => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: 'b',
          headSha: 'sha1',
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    pr.select('sha1');
    await tick(350);
    expect(pr.bySha.value.size).toBe(1);
    expect(pr.selected.value?.kind).toBe('ok');

    const genBefore = pr.generation.value;
    transport.emit('repo.changed', { repoId: REPO, kind: 'refsChanged' });

    expect(pr.bySha.value.size).toBe(0);
    expect(pr.byBranch.value.size).toBe(0);
    expect(pr.selected.value).toBeUndefined();
    expect(pr.generation.value).toBeGreaterThan(genBefore);
    pr.dispose();
  });
});

describe('PrState — a disabled repo never re-requests', () => {
  test('once a lookup answers "disabled", every later selection/branch resolve skips the network entirely', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);

    transport.onRequest = () => ({ kind: 'disabled' });
    pr.select('sha1');
    await tick(350);
    expect(pr.selected.value?.kind).toBe('disabled');
    const callsAfterFirst = transport.calls.length;

    pr.select('sha2');
    await tick(350);
    expect(pr.selected.value?.kind).toBe('disabled');
    // No new request at all — the synchronous disabled short-circuit in select() fired instead.
    expect(transport.calls.length).toBe(callsAfterFirst);

    await pr.resolveBranch('feature');
    expect(transport.calls.length).toBe(callsAfterFirst);
    expect(pr.byBranch.value.has('feature')).toBe(false);
    pr.dispose();
  });

  test('a repo change clears the disabled memo', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({ kind: 'disabled' });
    pr.select('sha1');
    await tick(350);
    expect(pr.selected.value?.kind).toBe('disabled');

    pr.setRepoId('/repos/b');
    transport.onRequest = () => ({ kind: 'ok', prs: [] });
    pr.select('sha1');
    await tick(350);
    expect(pr.selected.value?.kind).toBe('ok');
    pr.dispose();
  });
});

describe('PrState — unavailable surfaces GhStatus', () => {
  test('an unavailable resolve sets status but not bySha', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    const gh: GhStatus = { kind: 'unauthenticated', reason: 'run `gh auth login`' };
    transport.onRequest = () => ({ kind: 'unavailable', gh });

    pr.select('sha1');
    await tick(350);

    expect(pr.selected.value).toEqual({ kind: 'unavailable', gh });
    expect(pr.status.value).toEqual(gh);
    expect(pr.bySha.value.has('sha1')).toBe(false);
    pr.dispose();
  });
});

describe('PrState — ensureSnapshot warms only uncached branches', () => {
  test('a branch already in byBranch is not re-requested', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = (_method, params) => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: (params as { branch: string }).branch,
          headSha: 's',
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });

    await pr.ensureSnapshot(['main', 'feature']);
    expect(transport.calls.filter((c) => c.method === 'branch.resolvePr').length).toBe(2);

    await pr.ensureSnapshot(['main', 'feature', 'third']);
    const resolveCalls = transport.calls.filter((c) => c.method === 'branch.resolvePr');
    expect(resolveCalls.length).toBe(3); // only "third" is new.
    pr.dispose();
  });
});

// G31 round-2 performance review, finding #3: a branch whose resolvePr answer came back "ok" with
// no PR at all never landed in byBranch (only a real PrRecord goes in there), so ensureSnapshot's
// own dedup filter (!byBranch.has(name) && !#branchRequests.has(name)) failed forever and every
// PR-less branch was re-requested on every ensureSnapshot call, indefinitely.
describe('PrState — resolveBranch caches a "no PR" answer', () => {
  test('a branch that resolves to no PR is not re-requested by a later ensureSnapshot', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({ kind: 'ok', prs: [] });

    await pr.ensureSnapshot(['no-pr-branch']);
    expect(transport.calls.filter((c) => c.method === 'branch.resolvePr').length).toBe(1);
    expect(pr.byBranch.value.has('no-pr-branch')).toBe(false);

    await pr.ensureSnapshot(['no-pr-branch']);
    await pr.resolveBranch('no-pr-branch');
    expect(transport.calls.filter((c) => c.method === 'branch.resolvePr').length).toBe(1);
    pr.dispose();
  });
});

// G30 round-1 performance review, finding #1: ensureSnapshot used to Promise.all every branch at
// once — a repo with hundreds of branches fired hundreds of concurrent branch.resolvePr requests
// with nothing capping it anywhere in the stack. Proves the worker-pool bound: with 20 branches to
// warm and every request left hanging, no more than 6 are ever in flight at once.
describe('PrState — ensureSnapshot bounds its own fan-out', () => {
  test('never more than 6 branch.resolvePr requests are in flight at once', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);

    const resolvers: Array<(v: unknown) => void> = [];
    transport.onRequest = () =>
      new Promise((resolve) => {
        resolvers.push(resolve);
      });

    const branches = Array.from({ length: 20 }, (_, i) => `branch-${i}`);
    const done = pr.ensureSnapshot(branches);

    // Draining the whole queue in batches proves the cap holds throughout (not just at the very
    // first tick) — each resolved worker immediately picks up the next branch, so a broken cap
    // would show up as a batch bigger than 6 on a later iteration too.
    let resolvedCount = 0;
    while (resolvedCount < branches.length) {
      await tick(10); // let every worker that's going to start this round actually start.
      expect(resolvers.length).toBeGreaterThan(0);
      expect(resolvers.length).toBeLessThanOrEqual(6);
      const batch = resolvers.splice(0, resolvers.length);
      for (const resolve of batch) resolve({ kind: 'ok', prs: [] });
      resolvedCount += batch.length;
    }
    await done;

    expect(transport.calls.filter((c) => c.method === 'branch.resolvePr').length).toBe(20);
    pr.dispose();
  });
});

// P74 §4.2/§10: rebuildAncestry's own bounded breadth-first walk — several interacting rules
// (first-writer-wins, a budget cut-off, a tip the loaded window never reached) whose wrong
// answers are invisible in a screenshot, CLAUDE.md's own bar for a dedicated test here.
describe('PrState — rebuildAncestry: bounded ancestry walk', () => {
  test('walks every ancestor from a PR branch tip', async () => {
    const { store, shas } = buildChain(3);
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: 'main',
          headSha: shas[0],
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    await pr.resolveBranch('main');

    pr.rebuildAncestry(store);

    expect(pr.prByAncestry.value.size).toBe(3);
    for (const s of shas) expect(pr.prForCommit(s)?.[0]?.number).toBe(1);
    pr.dispose();
  });

  test('first-writer-wins when two PR branches reach the same ancestor', async () => {
    const shared = sha(0);
    const a = sha(1);
    const b = sha(2);
    const store = new CommitStore();
    store.append(record(a, [shared]));
    store.append(record(b, [shared]));
    store.append(record(shared, []));

    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = (_method, params) => {
      const branch = (params as { branch: string }).branch;
      const headSha = branch === 'branchA' ? a : b;
      const number = branch === 'branchA' ? 1 : 2;
      return {
        kind: 'ok',
        prs: [
          {
            number,
            title: 't',
            url: 'u',
            state: 'open',
            headRef: branch,
            headSha,
            baseRef: 'main',
            updatedAt: 0,
          },
        ],
      };
    };
    // Sequential, not Promise.all — byBranch's own insertion order (and so the queue's seed
    // order, "byBranch's own iteration order") depends on which resolveBranch settles first.
    await pr.resolveBranch('branchA');
    await pr.resolveBranch('branchB');

    pr.rebuildAncestry(store);

    // branchA resolved first, so its own PR wins the ancestor both tips share.
    expect(pr.prForCommit(shared)?.[0]?.number).toBe(1);
    expect(pr.prForCommit(a)?.[0]?.number).toBe(1);
    expect(pr.prForCommit(b)?.[0]?.number).toBe(2);
    pr.dispose();
  });

  test('a tip outside the loaded window contributes nothing', async () => {
    const { store, shas } = buildChain(2);
    const outsideSha = sha(999); // never appended to this store.
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = (_method, params) => {
      const branch = (params as { branch: string }).branch;
      const headSha = branch === 'loaded' ? shas[0] : outsideSha;
      const number = branch === 'loaded' ? 1 : 2;
      return {
        kind: 'ok',
        prs: [
          {
            number,
            title: 't',
            url: 'u',
            state: 'open',
            headRef: branch,
            headSha,
            baseRef: 'main',
            updatedAt: 0,
          },
        ],
      };
    };
    await pr.resolveBranch('loaded');
    await pr.resolveBranch('missing');

    pr.rebuildAncestry(store);

    expect(pr.prByAncestry.value.size).toBe(2); // only the loaded branch's own two rows.
    expect(pr.prForCommit(shas[0] as string)?.[0]?.number).toBe(1);
    expect(pr.prForCommit(outsideSha)).toBeUndefined();
    pr.dispose();
  });

  test('a budget cutoff stops the walk mid-history', async () => {
    // `rebuildAncestry`'s own `budget` param (defaulted to PR_ANCESTRY_WALK_BUDGET everywhere
    // except here) lets this prove the cutoff itself on a 5-row chain instead of building the
    // real 50,000-row fixture the production default would need to exercise the same branch.
    const { store, shas } = buildChain(5);
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: 'main',
          headSha: shas[0],
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    await pr.resolveBranch('main');

    pr.rebuildAncestry(store, 3);

    expect(pr.prByAncestry.value.size).toBe(3);
    expect(pr.prForCommit(shas[2] as string)?.[0]?.number).toBe(1); // the last row the budget reaches.
    expect(pr.prForCommit(shas[3] as string)).toBeUndefined(); // one row past the cutoff.
    pr.dispose();
  });

  // P79 fix, Functional finding HIGH: the walk used to have no stopping point at the PR's own
  // base, tagging every ancestor of the tip including the base branch's own history behind the
  // branch point. `main`'s tip is decorated here (the only fixture in this file that is) so
  // `rowOfBranchTip` can resolve `baseRef` locally — every other test's chain has no decorations
  // at all, which is exactly the "base not resolvable locally" fallback path those tests already
  // cover by continuing to walk the whole chain.
  test('stops the walk at the PR base — commits behind it are never tagged', async () => {
    const mainTip = sha(3);
    const m1 = sha(4);
    const m2 = sha(5);
    const f1 = sha(2);
    const f2 = sha(1);
    const fTip = sha(0);
    const store = new CommitStore();
    store.append(record(fTip, [f2]));
    store.append(record(f2, [f1]));
    store.append(record(f1, [mainTip]));
    store.append({
      ...record(mainTip, [m1]),
      decoration: [{ kind: 'branch', name: 'main', isHead: false }],
    });
    store.append(record(m1, [m2]));
    store.append(record(m2, []));

    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: 'feature',
          headSha: fTip,
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    await pr.resolveBranch('feature');

    pr.rebuildAncestry(store);

    // Only the three commits the branch actually adds — mainTip and everything behind it belongs
    // to main, not to this PR.
    expect(pr.prByAncestry.value.size).toBe(3);
    for (const s of [fTip, f2, f1]) expect(pr.prForCommit(s)?.[0]?.number).toBe(1);
    for (const s of [mainTip, m1, m2]) expect(pr.prForCommit(s)).toBeUndefined();
    pr.dispose();
  });

  test('refsChanged clears prByAncestry, and so does a repo switch', async () => {
    const { store, shas } = buildChain(2);
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const pr = new PrState(bridge);
    pr.setRepoId(REPO);
    transport.onRequest = () => ({
      kind: 'ok',
      prs: [
        {
          number: 1,
          title: 't',
          url: 'u',
          state: 'open',
          headRef: 'main',
          headSha: shas[0],
          baseRef: 'main',
          updatedAt: 0,
        },
      ],
    });
    await pr.resolveBranch('main');
    pr.rebuildAncestry(store);
    expect(pr.prByAncestry.value.size).toBe(2);

    transport.emit('repo.changed', { repoId: REPO, kind: 'refsChanged' });
    expect(pr.prByAncestry.value.size).toBe(0);

    // Re-populate, then prove a repo switch (not only refsChanged) clears it too.
    await pr.resolveBranch('main');
    pr.rebuildAncestry(store);
    expect(pr.prByAncestry.value.size).toBe(2);
    pr.setRepoId('/repos/b');
    expect(pr.prByAncestry.value.size).toBe(0);
    pr.dispose();
  });
});
