import { describe, expect, test } from 'bun:test';
import type { BaseResolution } from '@kira/git-ipc';
import { sleep } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import type { Capabilities } from './detailActions.ts';
import { ReviewSessionState } from './review.ts';

const CAPABILITIES: Capabilities = {
  openInEditor: true,
  goToFile: true,
  clipboard: true,
  resolveConflict: false,
  openWorktreeWindow: false,
  runPrepareScript: false,
  write: true,
  openExternal: true,
};

const REPO_A = '/repos/a';
const BRANCH = 'feature';

function emptyResolution(base: string): BaseResolution {
  return {
    branch: BRANCH,
    base,
    reason: 'defaultBranch',
    range: { kind: 'empty' },
    candidates: [],
  };
}

type ResolveBaseParams = { repoId: string; branch: string; base?: string };

/**
 * F8's own scriptable fake `Transport`: every `review.resolveBase` call hangs until the test
 * settles it explicitly, by call order — so a background `#checkForChange()` (triggered via
 * `emit('repo.changed', ...)`, exactly like the real transport's live push) can be left in flight
 * while a real `setBase` call's OWN `review.resolveBase` lands and resolves first, the exact race
 * the finding names. Every resolution here uses `range.kind: 'empty'`, so `#applyResolution` never
 * opens `graph.stream` — no `stream()` scripting needed.
 */
class ReviewRaceTransport {
  readonly resolveBaseCalls: Array<{
    params: ResolveBaseParams;
    settle: (result: BaseResolution) => void;
  }> = [];
  #handlers = new Map<string, Set<(payload: unknown) => void>>();

  request(method: string, params: unknown): Promise<unknown> {
    if (method !== 'review.resolveBase') {
      return Promise.reject(new Error(`ReviewRaceTransport: unscripted request '${method}'`));
    }
    return new Promise((resolve) => {
      this.resolveBaseCalls.push({
        params: params as ResolveBaseParams,
        settle: resolve as (result: BaseResolution) => void,
      });
    });
  }

  on(method: string, handler: (payload: unknown) => void): () => void {
    let set = this.#handlers.get(method);
    if (!set) {
      set = new Set();
      this.#handlers.set(method, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  emit(method: string, payload: unknown): void {
    for (const handler of this.#handlers.get(method) ?? []) handler(payload);
  }

  stream(): Promise<void> {
    return Promise.reject(new Error('ReviewRaceTransport: stream not used by this test'));
  }

  dispose(): void {}
}

describe('ReviewSessionState — F8 #checkForChange race', () => {
  test('a background re-resolve that settles AFTER a real setBase never flags a stale banner nor reverts the base', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: the fake only implements the subset of Transport this test drives.
    const transport = new ReviewRaceTransport() as any;
    const bridge = new BridgeClient(transport);
    const review = new ReviewSessionState(bridge, CAPABILITIES);

    // setTarget's own initial resolve — lands on 'main'.
    const setTargetPromise = review.setTarget(REPO_A, BRANCH);
    await sleep();
    expect(transport.resolveBaseCalls).toHaveLength(1);
    transport.resolveBaseCalls[0]?.settle(emptyResolution('main'));
    await setTargetPromise;
    expect(review.resolution.value?.base).toBe('main');
    const resolutionAfterSetTarget = review.resolution.value;

    // A `refsChanged` event fires — `#checkForChange`'s own `review.resolveBase` request is left
    // hanging, exactly like a slow server round trip.
    transport.emit('repo.changed', { repoId: REPO_A, kind: 'refsChanged' });
    await sleep();
    expect(transport.resolveBaseCalls).toHaveLength(2);

    // Before that check settles, the user explicitly picks a different base — setBase's own
    // request resolves immediately, superseding it.
    const setBasePromise = review.setBase('develop');
    await sleep();
    expect(transport.resolveBaseCalls).toHaveLength(3);
    transport.resolveBaseCalls[2]?.settle(emptyResolution('develop'));
    await setBasePromise;
    expect(review.resolution.value?.base).toBe('develop');
    expect(review.resolution.value).not.toBe(resolutionAfterSetTarget);

    // NOW the stale background check finally settles, with an answer that DOES differ from what
    // it captured ('main') — if applied, this would wrongly flag the stale-review banner, and
    // clicking it would silently discard the user's deliberate 'develop' choice back to 'release'.
    transport.resolveBaseCalls[1]?.settle(emptyResolution('release'));
    await sleep();

    expect(review.staleReview.value).toBe(false);
    expect(review.resolution.value?.base).toBe('develop');

    review.dispose();
  });
});
