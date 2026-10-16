import { describe, expect, test } from 'bun:test';
import type { ResultOf } from '@kira/git-ipc';
import { deferred } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import { FakeTransport } from '../testing/fakeTransport.ts';
import { RefsState } from './refs.ts';

function refsResult(headName: string): ResultOf<'refs.list'> {
  return {
    branches: [],
    remoteBranches: [],
    tags: [],
    head: { kind: 'branch', name: headName },
  };
}

// F5: the server runs one goroutine per request, so two `repo.changed` (`refsChanged`) events in
// quick succession — a commit then a checkout, say — can have their `refs.list` replies arrive in
// EITHER order. Before this fix, `reload()` guarded only on `repoId`, so the older reply, arriving
// last, silently overwrote the newer one and stayed there until the next event.
describe('RefsState — F5 out-of-order reload() replies', () => {
  test('an older reload() reply that resolves after a newer one is dropped, not applied', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const refs = new RefsState(bridge);

    transport.onRequest = () => refsResult('main');
    refs.setRepoId('/repos/a');
    await refs.reload();
    expect(transport.calls).toHaveLength(2); // setRepoId's own initial reload() plus this one.

    const first = deferred<ResultOf<'refs.list'>>();
    const second = deferred<ResultOf<'refs.list'>>();
    let call = 0;
    transport.onRequest = () => {
      call++;
      return call === 1 ? first.promise : second.promise;
    };

    // Two `refsChanged` events land back to back (e.g. a commit immediately followed by a
    // checkout) — both trigger their own `reload()`, exactly as the `repo.changed` subscription
    // in the constructor does, before either request has settled.
    const reloadA = refs.reload();
    const reloadB = refs.reload();
    expect(transport.calls).toHaveLength(4);

    // The OLDER request (A, "still on main") resolves AFTER the newer one (B, "now on feature") —
    // exactly the out-of-order case the finding names.
    second.resolve(refsResult('feature'));
    await reloadB;
    expect(refs.currentBranchName.value).toBe('feature');

    first.resolve(refsResult('main'));
    await reloadA;

    // The stale "main" reply must never have overwritten the newer "feature" state.
    expect(refs.currentBranchName.value).toBe('feature');

    refs.dispose();
  });
});
