import { describe, expect, test } from 'bun:test';
import { SETTINGS } from '@kira/git-core';
import type { RepoSettingsSnapshot } from '@kira/git-ipc';
import { sleep } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import { FakeTransport } from '../testing/fakeTransport.ts';
import { RepoSettingsState } from './repoSettings.ts';

function defaultSnapshot(): RepoSettingsSnapshot {
  return {
    'kiraSpace.graph.pageSize': SETTINGS['kiraSpace.graph.pageSize'].default,
    'kiraSpace.graph.scope': SETTINGS['kiraSpace.graph.scope'].default,
    'kiraSpace.stash.showInGraph': SETTINGS['kiraSpace.stash.showInGraph'].default,
    'kiraSpace.stash.includeUntracked': SETTINGS['kiraSpace.stash.includeUntracked'].default,
    'kiraSpace.review.baseCandidates': SETTINGS['kiraSpace.review.baseCandidates'].default,
    'kiraSpace.pull.strategy': SETTINGS['kiraSpace.pull.strategy'].default,
    'kiraSpace.log.level': SETTINGS['kiraSpace.log.level'].default,
    'kiraSpace.github.enabled': SETTINGS['kiraSpace.github.enabled'].default,
    'kiraSpace.worktree.prepareScript': SETTINGS['kiraSpace.worktree.prepareScript'].default,
    'kiraSpace.worktree.basePath': SETTINGS['kiraSpace.worktree.basePath'].default,
    'kiraSpace.checkout.autoStash': SETTINGS['kiraSpace.checkout.autoStash'].default,
  };
}

describe('RepoSettingsState', () => {
  test('starts at the schema defaults before any repo is set', () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    expect(state.settings.value).toEqual(defaultSnapshot());
    state.dispose();
  });

  test('setRepoId loads the repo’s own stored settings', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);

    transport.onRequest = (method, params) => {
      expect(method).toBe('repoSettings.get');
      expect(params).toEqual({ repoId: '/repos/a' });
      return { ...defaultSnapshot(), 'kiraSpace.pull.strategy': 'rebase' };
    };
    state.setRepoId('/repos/a');
    await sleep();

    expect(state.settings.value['kiraSpace.pull.strategy']).toBe('rebase');
    state.dispose();
  });

  test('setRepoId(undefined) resets to the schema defaults', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => ({ ...defaultSnapshot(), 'kiraSpace.pull.strategy': 'merge' });
    state.setRepoId('/repos/a');
    await sleep();
    expect(state.settings.value['kiraSpace.pull.strategy']).toBe('merge');

    state.setRepoId(undefined);
    expect(state.settings.value).toEqual(defaultSnapshot());
    state.dispose();
  });

  test('set() patches only the changed leaf and adopts the server’s own resulting snapshot', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => defaultSnapshot();
    state.setRepoId('/repos/a');
    await sleep();

    transport.onRequest = (method, params) => {
      expect(method).toBe('repoSettings.set');
      expect(params).toEqual({
        repoId: '/repos/a',
        patch: { 'kiraSpace.graph.pageSize': 1000 },
      });
      return { ...defaultSnapshot(), 'kiraSpace.graph.pageSize': 1000 };
    };
    await state.set({ 'kiraSpace.graph.pageSize': 1000 });
    expect(state.settings.value['kiraSpace.graph.pageSize']).toBe(1000);
    state.dispose();
  });

  // G24 D16's own settings round trip: default true, set false, the server's own resulting
  // snapshot is adopted — the same "patch, don't replace" shape every other leaf above already
  // exercises, applied to the eighth key.
  test('github.enabled round-trips: default true, set false, adopts the result', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    expect(state.settings.value['kiraSpace.github.enabled']).toBe(true);

    transport.onRequest = () => defaultSnapshot();
    state.setRepoId('/repos/a');
    await sleep();
    expect(state.settings.value['kiraSpace.github.enabled']).toBe(true);

    transport.onRequest = (method, params) => {
      expect(method).toBe('repoSettings.set');
      expect(params).toEqual({
        repoId: '/repos/a',
        patch: { 'kiraSpace.github.enabled': false },
      });
      return { ...defaultSnapshot(), 'kiraSpace.github.enabled': false };
    };
    await state.set({ 'kiraSpace.github.enabled': false });
    expect(state.settings.value['kiraSpace.github.enabled']).toBe(false);
    state.dispose();
  });

  // P72 §9.2: replaces G18 §3.18/§4.12's own D14 sentinel-collapse guard — a repoSettings.changed
  // event naming a DIFFERENT repo must now be ignored entirely, log.level included; the cross-repo
  // collapse it used to carry is deleted.
  test('repoSettings.changed from a different repo is ignored entirely', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => ({
      ...defaultSnapshot(),
      'kiraSpace.pull.strategy': 'rebase',
    });
    state.setRepoId('/repos/a');
    await sleep();
    expect(state.settings.value['kiraSpace.pull.strategy']).toBe('rebase');

    transport.emit('repoSettings.changed', {
      repoId: '/repos/b',
      settings: {
        ...defaultSnapshot(),
        'kiraSpace.log.level': 'debug',
        'kiraSpace.pull.strategy': 'merge',
      },
    });

    // /repos/b's own write must NOT have touched /repos/a's state at all, log.level included.
    expect(state.settings.value['kiraSpace.log.level']).toBe(
      SETTINGS['kiraSpace.log.level'].default,
    );
    expect(state.settings.value['kiraSpace.pull.strategy']).toBe('rebase');
    state.dispose();
  });

  test('repoSettings.changed from THIS repo replaces the whole snapshot', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => defaultSnapshot();
    state.setRepoId('/repos/a');
    await sleep();

    transport.emit('repoSettings.changed', {
      repoId: '/repos/a',
      settings: { ...defaultSnapshot(), 'kiraSpace.graph.scope': 'head' },
    });

    expect(state.settings.value['kiraSpace.graph.scope']).toBe('head');
    state.dispose();
  });
});
