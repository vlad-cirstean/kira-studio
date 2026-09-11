import { describe, expect, test } from 'bun:test';
import type {
  CheckoutPreflight,
  EventKey,
  EventPayload,
  OpResult,
  ParamsOf,
  PullPreflight,
  RefRow,
  RemoteOpResult,
  RequestKey,
  ResultOf,
  RevertPreflight,
  StashEntry,
  StatusSummary,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { OpsState, remoteFromUpstreamRef } from './ops.ts';
import { RefsState } from './refs.ts';

/** Same fake `Transport` shape `pr.test.ts` already established — request() is scripted per
 *  method via `onRequest`, which receives the method name so one script can branch on it. */
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

const STATUS: StatusSummary = {
  head: { kind: 'branch', name: 'main' },
  upstream: { name: 'origin/main', ahead: 0, behind: 1 },
  counts: { staged: 0, unstaged: 0, untracked: 1, unmerged: 0 },
  isClean: false,
  dirtyPaths: ['untracked.txt'],
  dirtyTruncated: false,
  inProgress: null,
};

const PRE_EXISTING_STASH: StashEntry = {
  index: 0,
  sha: 'existing-stash-sha',
  baseSha: 'base-sha',
  baseSubject: 'an unrelated earlier stash',
  indexSha: 'index-sha',
  untrackedSha: undefined,
  message: "WIP on main: the user's own earlier stash",
  branch: 'main',
  timestamp: 0,
  fileCount: 1,
  includedUntracked: false,
  scope: 'stack',
  ref: '',
};

// G31 round-2 functional-correctness review, finding #1 (high): #stashAndCarry used to treat
// stash.list's post-push entries[0] as "the entry stashAndCarry itself just pushed". When the
// worktree is dirty ONLY with untracked files, stashPush (called with includeUntracked: false)
// is a git no-op — "No local changes to save", exit 0 — so pushResult.ok is true but the stash
// stack is unchanged. If the user already had a stash of their own, that PRE-EXISTING entry is
// still entries[0], and the old code ran preflight.stashPop + op.run stashPop against it —
// silently applying and deleting a stash this pull never created.
describe('OpsState — #stashAndCarry (via runPull) never touches a pre-existing, unrelated stash', () => {
  test('an untracked-only no-op stashPush leaves a pre-existing stash alone', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const refs = new RefsState(bridge);
    const ops = new OpsState(bridge, refs);

    const preflight: PullPreflight = {
      strategy: 'merge',
      source: 'default',
      upstream: 'origin/main',
      ahead: 0,
      behind: 1,
      dirty: true,
      routes: [],
      blockers: ['dirtyNonFastForward'],
    };
    const pushResult: OpResult = {
      ok: true,
      error: undefined,
      undo: null,
      head: { kind: 'branch', name: 'main' },
      inProgress: null,
    };
    const pullResult: RemoteOpResult = {
      ok: true,
      error: undefined,
      updates: [],
      head: { kind: 'branch', name: 'main' },
      inProgress: null,
    };

    transport.onRequest = (method) => {
      switch (method) {
        case 'status.get':
          return STATUS;
        case 'undo.peek':
          return { slot: null };
        case 'remote.pullPreflight':
          return preflight;
        case 'stash.list':
          // Unchanged across every call: the no-op push never touches the stack.
          return { entries: [PRE_EXISTING_STASH] };
        case 'op.run':
          return pushResult;
        case 'remote.run':
          return pullResult;
        default:
          throw new Error(`unscripted request: ${method}`);
      }
    };
    ops.setRepoId(REPO);
    await tick(); // let setRepoId's own fire-and-forget refreshStatus/refreshUndo settle first.

    const runPromise = ops.runPull('origin', 'main');
    // runPull's blockers.length > 0 branch awaits #confirmPull before doing anything else —
    // resolve it exactly as PullDialog.vue's own "Stash and pull" button would.
    await tick();
    ops.resolvePullDialog(true);
    await runPromise;

    const stashPopAttempted = transport.calls.some(
      (c) =>
        c.method === 'preflight.stashPop' ||
        (c.method === 'op.run' && (c.params as { op: { kind: string } }).op.kind === 'stashPop'),
    );
    expect(stashPopAttempted).toBe(false);
    expect(ops.announcement.value).toBe('Pulled origin/main (merge)');
  });
});

describe('remoteFromUpstreamRef', () => {
  test('extracts the remote name from a remote-tracking upstream', () => {
    expect(remoteFromUpstreamRef('refs/remotes/origin/feature')).toBe('origin');
    expect(remoteFromUpstreamRef('refs/remotes/upstream/main')).toBe('upstream');
  });

  test('undefined for a purely local upstream (no remote to pull from)', () => {
    expect(remoteFromUpstreamRef('refs/heads/main')).toBeUndefined();
  });

  test('undefined for no upstream at all', () => {
    expect(remoteFromUpstreamRef(undefined)).toBeUndefined();
  });
});

// G-UX (item 3): "when checking out a branch that advanced, ask if I want to pull it too" —
// runCheckout's own post-switch confirm step.
describe('OpsState — post-checkout pull prompt', () => {
  function branchRow(overrides: Partial<RefRow> = {}): RefRow {
    return {
      refname: 'refs/heads/feature',
      kind: 'branch',
      shortName: 'feature',
      objectId: 'sha-feature',
      peeledObjectId: undefined,
      upstream: 'refs/remotes/origin/feature',
      track: { ahead: 0, behind: 3 },
      committerDate: 0,
      isHead: false,
      checkedOutIn: undefined,
      annotation: undefined,
      ...overrides,
    };
  }

  const CLEAN_CHECKOUT_PREFLIGHT: CheckoutPreflight = {
    target: { kind: 'branch', name: 'feature' },
    detaches: false,
    createsTracking: undefined,
    carried: [],
    blockers: [],
    verdict: 'clean',
    routes: [],
  };

  const CHECKOUT_RESULT: OpResult = {
    ok: true,
    error: undefined,
    undo: null,
    head: { kind: 'branch', name: 'feature' },
    inProgress: null,
  };

  function setUp(branches: readonly RefRow[]): {
    ops: OpsState;
    refs: RefsState;
    transport: FakeTransport;
  } {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const refs = new RefsState(bridge);
    const ops = new OpsState(bridge, refs);
    transport.onRequest = (method) => {
      switch (method) {
        case 'status.get':
          return STATUS;
        case 'undo.peek':
          return { slot: null };
        case 'preflight.checkout':
          return CLEAN_CHECKOUT_PREFLIGHT;
        case 'op.run':
          return CHECKOUT_RESULT;
        default:
          throw new Error(`unscripted request: ${method}`);
      }
    };
    ops.setRepoId(REPO);
    refs.branches.value = branches;
    return { ops, refs, transport };
  }

  test('prompts, and "Pull now" runs the pull against the branch\'s own upstream remote', async () => {
    const { ops, transport } = setUp([branchRow()]);
    // Script the pull half only once the checkout half has run — `remote.pullPreflight`/
    // `remote.run` are not requests the checkout-only fixture above answers.
    let pullPreflightRequested = false;
    const originalOnRequest = transport.onRequest;
    transport.onRequest = (method, params) => {
      if (method === 'remote.pullPreflight') {
        pullPreflightRequested = true;
        return {
          strategy: 'merge',
          source: 'default',
          upstream: 'origin/feature',
          ahead: 0,
          behind: 3,
          dirty: false,
          routes: [],
          blockers: [],
        } satisfies PullPreflight;
      }
      if (method === 'remote.run') {
        return {
          ok: true,
          error: undefined,
          updates: [],
          head: { kind: 'branch', name: 'feature' },
          inProgress: null,
        } satisfies RemoteOpResult;
      }
      return originalOnRequest(method, params);
    };

    await tick();
    const runPromise = ops.runCheckout('feature', 'switch');
    // runCheckout's own post-switch prompt awaits #confirmPostCheckoutPull — resolve it exactly
    // as PostCheckoutPullDialog.vue's own "Pull now" button would, before awaiting the call's own
    // completion (it does not resolve until the dialog does).
    await tick();
    expect(ops.pendingPostCheckoutPull.value).toEqual({
      branch: 'feature',
      remote: 'origin',
      upstreamShortName: 'origin/feature',
      behind: 3,
    });

    ops.resolvePostCheckoutPullDialog(true);
    await runPromise;

    expect(pullPreflightRequested).toBe(true);
    const pullCall = transport.calls.find((c) => c.method === 'remote.run');
    if (pullCall === undefined) throw new Error('expected a remote.run call');
    const pullParams = pullCall.params as { remote: string; branch: string };
    expect(pullParams.remote).toBe('origin');
    expect(pullParams.branch).toBe('feature');
  });

  test('"Not now" leaves the branch checked out without pulling', async () => {
    const { ops, transport } = setUp([branchRow()]);
    await tick();
    const runPromise = ops.runCheckout('feature', 'switch');
    await tick();

    expect(ops.pendingPostCheckoutPull.value).toBeDefined();
    ops.resolvePostCheckoutPullDialog(false);
    await runPromise;

    expect(ops.pendingPostCheckoutPull.value).toBeUndefined();
    expect(transport.calls.some((c) => c.method === 'remote.pullPreflight')).toBe(false);
  });

  test('no prompt when the branch is already up to date', async () => {
    const { ops } = setUp([branchRow({ track: { ahead: 0, behind: 0 } })]);
    await tick();
    await ops.runCheckout('feature', 'switch');
    expect(ops.pendingPostCheckoutPull.value).toBeUndefined();
  });

  test('no prompt when the branch has no upstream', async () => {
    const { ops } = setUp([branchRow({ track: undefined, upstream: undefined })]);
    await tick();
    await ops.runCheckout('feature', 'switch');
    expect(ops.pendingPostCheckoutPull.value).toBeUndefined();
  });

  test('no prompt when the upstream is gone', async () => {
    const { ops } = setUp([branchRow({ track: 'gone' })]);
    await tick();
    await ops.runCheckout('feature', 'switch');
    expect(ops.pendingPostCheckoutPull.value).toBeUndefined();
  });

  test('no prompt on a detach, even to a target behind its own upstream', async () => {
    const { ops } = setUp([branchRow()]);
    await tick();
    await ops.runCheckout('feature', 'detach');
    expect(ops.pendingPostCheckoutPull.value).toBeUndefined();
  });
});

// G32 round-3 functional-correctness review, finding #7: every #confirm* dialog above (checkout,
// revert, reset, cherry-pick, stash apply/pop, pull, force push) opens a promise that only
// resolves once the user actually clicks a button — arbitrarily long real-world wall-clock time,
// during which App.vue's "Open in graph" can call OpsState.setRepoId() directly (it does not wait
// on `busy`, since revealCommitInGraph is independent of whatever operation is mid-confirm). Before
// this fix, resolving a stale dialog against the now-active repo would run op.run/#applyResult with
// the OLD repoId's preflight/route but write results into whatever OpsState now considers current —
// cross-repo data corruption. Exercises the pattern via runRevert; the same guard shape is applied
// identically at every other #confirm* call site.
describe('OpsState — a stale confirm dialog no-ops if the active repo changed while it was open', () => {
  test('runRevert never calls op.run when the repo changes before the revert dialog resolves', async () => {
    const OTHER_REPO = '/repos/b';
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const refs = new RefsState(bridge);
    const ops = new OpsState(bridge, refs);

    const preflight: RevertPreflight = {
      shas: ['sha1'],
      mainlineRequired: [],
      dirtyPaths: [],
      inProgress: null,
      prediction: { kind: 'clean' },
      predictedFor: 'sha1',
      detachedHead: false,
      verdict: 'willConflict',
      blockers: [],
    };

    transport.onRequest = (method) => {
      switch (method) {
        case 'status.get':
          return STATUS;
        case 'undo.peek':
          return { slot: null };
        case 'preflight.revert':
          return preflight;
        default:
          throw new Error(`unscripted request: ${method}`);
      }
    };
    ops.setRepoId(REPO);
    await tick();

    const runPromise = ops.runRevert(['sha1']);
    // runRevert's willConflict verdict awaits #confirmRevert before doing anything else.
    await tick();
    expect(ops.pendingRevert.value).toBeDefined();

    // The active repo changes while the dialog is still open — e.g. the user clicked "Open in
    // graph" on a commit from a different repo entirely.
    ops.setRepoId(OTHER_REPO);
    await tick();

    // Now the (stale) dialog resolves, as if the user had just clicked its confirm button.
    ops.resolveRevertDialog({ mainline: undefined, noCommit: false });
    await runPromise;

    const revertAttempted = transport.calls.some(
      (c) => c.method === 'op.run' && (c.params as { op: { kind: string } }).op.kind === 'revert',
    );
    expect(revertAttempted).toBe(false);
  });
});
