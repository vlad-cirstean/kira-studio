import { describe, expect, test } from 'bun:test';
import { SETTINGS } from '@kira/git-core';
import type {
  CheckoutPreflight,
  OpResult,
  RepoSettingsSnapshot,
  StatusSummary,
} from '@kira/git-ipc';
import { sleep } from '@workbench/testing/unit/async';
import { BridgeClient } from '../bridge/client.ts';
import { FakeTransport } from '../testing/fakeTransport.ts';
import { createRepoStates } from './repoStates.ts';

const REPO = '/repos/a';

const STATUS: StatusSummary = {
  head: { kind: 'branch', name: 'main' },
  upstream: undefined,
  counts: { staged: 0, unstaged: 1, untracked: 0, unmerged: 0 },
  isClean: false,
  dirtyPaths: ['a.txt'],
  dirtyTruncated: false,
  inProgress: null,
};

const BLOCKED: CheckoutPreflight = {
  target: { kind: 'branch', name: 'feature' },
  detaches: false,
  createsTracking: undefined,
  carried: [],
  blockers: [{ kind: 'blockedByTracked', paths: ['a.txt'] }],
  verdict: 'blocked',
  routes: ['discard', 'autoStash'],
};

const OK: OpResult = {
  ok: true,
  error: undefined,
  head: { kind: 'branch', name: 'feature' },
  inProgress: null,
  undo: null,
};

function settings(autoStash: boolean): RepoSettingsSnapshot {
  const snapshot = {} as Record<string, unknown>;
  for (const [key, def] of Object.entries(SETTINGS)) snapshot[key] = def.default;
  snapshot['kiraSpace.checkout.autoStash'] = autoStash;
  return snapshot as unknown as RepoSettingsSnapshot;
}

// P168 Part 18 F13: App.vue built OpsState without RepoSettingsState, so the opt-out was ignored.
describe('createRepoStates wiring — kiraSpace.checkout.autoStash', () => {
  async function setUp(autoStash: boolean) {
    const transport = new FakeTransport();
    transport.onRequest = (method) => {
      switch (method) {
        case 'repoSettings.get':
          return settings(autoStash);
        case 'status.get':
          return STATUS;
        case 'undo.peek':
          return { slot: null };
        case 'preflight.checkout':
          return BLOCKED;
        case 'op.run':
          return OK;
        default:
          throw new Error(`unscripted request: ${method}`);
      }
    };
    const states = createRepoStates(new BridgeClient(transport));
    states.repoSettingsState.setRepoId(REPO);
    states.opsState.setRepoId(REPO);
    await sleep();
    return { ...states, transport };
  }

  test('setting off: dialog opens, no auto-stash write', async () => {
    const { opsState, transport } = await setUp(false);
    const run = opsState.runCheckout('feature', 'switch');
    await sleep();
    expect(opsState.pendingCheckout.value).toBeDefined();
    expect(transport.calls.some((c) => c.method === 'op.run')).toBe(false);
    opsState.resolveCheckoutDialog(null);
    await run;
  });

  test('setting on: checkout re-issued with autoStash', async () => {
    const { opsState, transport } = await setUp(true);
    await opsState.runCheckout('feature', 'switch');
    const call = transport.calls.find((c) => c.method === 'op.run');
    if (call === undefined) throw new Error('expected an op.run call');
    expect((call.params as { op: { autoStash: boolean } }).op.autoStash).toBe(true);
  });
});
