import { describe, expect, test } from 'bun:test';
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
  test('onRefsChanged empties bySha/byBranch/selected/status and bumps generation', async () => {
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
    pr.onRefsChanged();

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
