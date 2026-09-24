import { describe, expect, test } from 'bun:test';
import type { GitStatus, RepoSummary } from '@kira/git-ipc';
import { deferred } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import { FakeTransport } from '../testing/fakeTransport.ts';
import { RepoState } from './repo.ts';

const GIT_OK: GitStatus = { kind: 'ok', path: '/usr/bin/git', version: '2.44.0' };

function repoSummary(repoId: string): RepoSummary {
  return {
    repoId,
    root: repoId,
    gitDir: `${repoId}/.git`,
    commonDir: `${repoId}/.git`,
    isBare: false,
    isLinkedWorktree: false,
    head: { kind: 'branch', name: 'main' },
  };
}

// P108 F4: `App.vue` has several independent paths (a worktree switch, a reveal-in-graph, a
// reconnect, the bootstrap candidate loop, a `NoRepositoryPanel` pick) that each call
// `RepoState.open()` and then act on its result. Before this fix `open()` applied every 'ok'
// result to `activeRepo` unconditionally, so two overlapping opens were last-*response*-wins —
// the UI could end up showing repo A's summary while the graph stream it actually reopened
// belonged to repo B, purely by network timing.
describe('RepoState — P108 F4 overlapping open() calls', () => {
  test('an older open() reply that resolves after a newer one is superseded, not applied', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const repo = new RepoState(bridge, GIT_OK);

    const first = deferred<{ kind: 'ok'; repo: RepoSummary }>();
    const second = deferred<{ kind: 'ok'; repo: RepoSummary }>();
    let call = 0;
    transport.onRequest = () => {
      call++;
      return call === 1 ? first.promise : second.promise;
    };

    // Two opens fire back to back (e.g. a quick double worktree switch) before either request
    // has settled.
    const openA = repo.open('/repos/a');
    const openB = repo.open('/repos/b');
    expect(repo.opening.value).toBe(true);

    // The OLDER request (A) resolves AFTER the newer one (B) — exactly the race the finding
    // names.
    second.resolve({ kind: 'ok', repo: repoSummary('/repos/b') });
    const outcomeB = await openB;
    expect(outcomeB.kind).toBe('ok');
    expect(repo.activeRepo.value?.repoId).toBe('/repos/b');

    first.resolve({ kind: 'ok', repo: repoSummary('/repos/a') });
    const outcomeA = await openA;

    // The stale reply for A must never win, however it resolves — the caller sees 'superseded'
    // (not 'ok'), so `App.vue`'s own `if (outcome.kind !== 'ok') return;` never calls
    // `handleRepoOpened` for it, and `activeRepo` is left exactly as B set it.
    expect(outcomeA.kind).toBe('superseded');
    expect(repo.activeRepo.value?.repoId).toBe('/repos/b');
    expect(repo.opening.value).toBe(false);

    repo.dispose();
  });

  test('opening clears once the single call in flight resolves', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const repo = new RepoState(bridge, GIT_OK);
    transport.onRequest = () => ({ kind: 'ok' as const, repo: repoSummary('/repos/a') });

    expect(repo.opening.value).toBe(false);
    await repo.open('/repos/a');
    expect(repo.opening.value).toBe(false);
    expect(repo.activeRepo.value?.repoId).toBe('/repos/a');

    repo.dispose();
  });
});
