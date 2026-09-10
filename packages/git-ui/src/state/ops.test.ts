import { describe, expect, test } from 'bun:test';
import type {
  EventKey,
  EventPayload,
  OpResult,
  ParamsOf,
  PullPreflight,
  RemoteOpResult,
  RequestKey,
  ResultOf,
  StashEntry,
  StatusSummary,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { OpsState } from './ops.ts';
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
