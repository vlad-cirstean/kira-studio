import { describe, expect, test } from 'bun:test';
import type { SettingDef, SettingKey } from '@kira/git-core';
import { SETTINGS } from '@kira/git-core';
import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RepoSettingsSnapshot,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { BridgeClient } from '../bridge/client.ts';
import { RepoSettingsState } from './repoSettings.ts';

function defaultSnapshot(): RepoSettingsSnapshot {
  return {
    'kiraVersion.graph.pageSize': SETTINGS['kiraVersion.graph.pageSize'].default,
    'kiraVersion.graph.scope': SETTINGS['kiraVersion.graph.scope'].default,
    'kiraVersion.stash.showInGraph': SETTINGS['kiraVersion.stash.showInGraph'].default,
    'kiraVersion.stash.includeUntracked': SETTINGS['kiraVersion.stash.includeUntracked'].default,
    'kiraVersion.review.baseCandidates': SETTINGS['kiraVersion.review.baseCandidates'].default,
    'kiraVersion.pull.strategy': SETTINGS['kiraVersion.pull.strategy'].default,
    'kiraVersion.log.level': SETTINGS['kiraVersion.log.level'].default,
    'kiraVersion.github.enabled': SETTINGS['kiraVersion.github.enabled'].default,
    'kiraVersion.worktree.prepareScript': SETTINGS['kiraVersion.worktree.prepareScript'].default,
    'kiraVersion.worktree.basePath': SETTINGS['kiraVersion.worktree.basePath'].default,
    'kiraVersion.checkout.autoStash': SETTINGS['kiraVersion.checkout.autoStash'].default,
  };
}

/** A minimal, in-memory Transport fake — request() is scripted per call via `onRequest`; on()
 *  records handlers so a test can fire an event synchronously with `emit`. Mirrors the shape
 *  every other `state/` module's own tests would need, had any existed before this phase (G18
 *  is git-ui's first test file at all — G16's own declared non-goal is a component-rendering
 *  tier, not unit tests for plain state classes). */
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

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
      return { ...defaultSnapshot(), 'kiraVersion.pull.strategy': 'rebase' };
    };
    state.setRepoId('/repos/a');
    await tick();

    expect(state.settings.value['kiraVersion.pull.strategy']).toBe('rebase');
    state.dispose();
  });

  test('setRepoId(undefined) resets to the schema defaults', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => ({ ...defaultSnapshot(), 'kiraVersion.pull.strategy': 'merge' });
    state.setRepoId('/repos/a');
    await tick();
    expect(state.settings.value['kiraVersion.pull.strategy']).toBe('merge');

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
    await tick();

    transport.onRequest = (method, params) => {
      expect(method).toBe('repoSettings.set');
      expect(params).toEqual({
        repoId: '/repos/a',
        patch: { 'kiraVersion.graph.pageSize': 1000 },
      });
      return { ...defaultSnapshot(), 'kiraVersion.graph.pageSize': 1000 };
    };
    await state.set({ 'kiraVersion.graph.pageSize': 1000 });
    expect(state.settings.value['kiraVersion.graph.pageSize']).toBe(1000);
    state.dispose();
  });

  // G24 D16's own settings round trip: default true, set false, the server's own resulting
  // snapshot is adopted — the same "patch, don't replace" shape every other leaf above already
  // exercises, applied to the eighth key.
  test('github.enabled round-trips: default true, set false, adopts the result', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    expect(state.settings.value['kiraVersion.github.enabled']).toBe(true);

    transport.onRequest = () => defaultSnapshot();
    state.setRepoId('/repos/a');
    await tick();
    expect(state.settings.value['kiraVersion.github.enabled']).toBe(true);

    transport.onRequest = (method, params) => {
      expect(method).toBe('repoSettings.set');
      expect(params).toEqual({
        repoId: '/repos/a',
        patch: { 'kiraVersion.github.enabled': false },
      });
      return { ...defaultSnapshot(), 'kiraVersion.github.enabled': false };
    };
    await state.set({ 'kiraVersion.github.enabled': false });
    expect(state.settings.value['kiraVersion.github.enabled']).toBe(false);
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
      'kiraVersion.pull.strategy': 'rebase',
    });
    state.setRepoId('/repos/a');
    await tick();
    expect(state.settings.value['kiraVersion.pull.strategy']).toBe('rebase');

    transport.emit('repoSettings.changed', {
      repoId: '/repos/b',
      settings: {
        ...defaultSnapshot(),
        'kiraVersion.log.level': 'debug',
        'kiraVersion.pull.strategy': 'merge',
      },
    });

    // /repos/b's own write must NOT have touched /repos/a's state at all, log.level included.
    expect(state.settings.value['kiraVersion.log.level']).toBe(
      SETTINGS['kiraVersion.log.level'].default,
    );
    expect(state.settings.value['kiraVersion.pull.strategy']).toBe('rebase');
    state.dispose();
  });

  test('repoSettings.changed from THIS repo replaces the whole snapshot', async () => {
    const transport = new FakeTransport();
    const bridge = new BridgeClient(transport);
    const state = new RepoSettingsState(bridge);
    transport.onRequest = () => defaultSnapshot();
    state.setRepoId('/repos/a');
    await tick();

    transport.emit('repoSettings.changed', {
      repoId: '/repos/a',
      settings: { ...defaultSnapshot(), 'kiraVersion.graph.scope': 'head' },
    });

    expect(state.settings.value['kiraVersion.graph.scope']).toBe('head');
    state.dispose();
  });
});

// P72 §9.2: replaces G18 D13/D10's own guard — instanceWide's only user (kiraVersion.log.level)
// is gone, so no repo-sourced key sets it any more.
describe('instanceWide flag the dialog would read off SETTINGS directly (D13)', () => {
  test('no repo-sourced key is instanceWide', () => {
    const repoKeys: SettingKey[] = [
      'kiraVersion.graph.pageSize',
      'kiraVersion.graph.scope',
      'kiraVersion.stash.showInGraph',
      'kiraVersion.stash.includeUntracked',
      'kiraVersion.review.baseCandidates',
      'kiraVersion.pull.strategy',
      'kiraVersion.log.level',
    ];
    for (const key of repoKeys) {
      const def: SettingDef<unknown> = SETTINGS[key];
      expect(Boolean(def.instanceWide)).toBe(false);
    }
  });
});
