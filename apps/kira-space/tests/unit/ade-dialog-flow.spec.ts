import { describe, expect, test } from 'bun:test';
import type { AgentEvent } from '@shared/domain/agent';
import {
  archiveSpec,
  type DialogCtx,
  type DialogSpec,
  type DialogState,
  moveSpec,
  rebaseSpec,
  startSpec,
} from '../../frontend/src/ade/dialogCompose';
import {
  justDeleteArchive,
  requestArchive,
  type SendDialogDeps,
  sendDialog,
} from '../../frontend/src/ade/dialogFlow';
import type { LaunchDeps } from '../../frontend/src/ade/launch';
import { localIsoOfMs } from '../../frontend/src/ade/localDay';
import {
  createTurnWatcher,
  type TurnOutcome,
  type TurnWatch,
} from '../../frontend/src/ade/turnWatch';
import { useQueue } from '../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeNewWork,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
} from '../../frontend/src/ade/wire';
import type { Settings } from '../../frontend/src/state/settingsDomain';

// P129 Part 4 §3.3 — turn watcher edge cases (pure, `turnWatch.ts`) plus flow scenarios
// (`dialogFlow.ts`), with fake deps (mutations, launch, turns). No Vue, no real timers.

// -----------------------------------------------------------------------------------------------
// Turn watcher
// -----------------------------------------------------------------------------------------------

function evt(terminalId: string, event: string): AgentEvent {
  return {
    terminalId,
    event,
    sessionId: '',
    cwd: '',
    toolName: '',
    toolUseId: '',
    notificationType: '',
    message: '',
    source: '',
    reason: '',
  };
}

describe('turnWatch', () => {
  test('requireSubmit: a Stop before submit is ignored; submit then Stop resolves stop', async () => {
    const tw = createTurnWatcher();
    const w = tw.watch('term-1', { requireSubmit: true });
    tw.onEvent(evt('term-1', 'Stop'));
    let settled = false;
    void w.done.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    tw.onEvent(evt('term-1', 'UserPromptSubmit'));
    tw.onEvent(evt('term-1', 'Stop'));
    expect(await w.done).toBe('stop');
  });

  test('launch (requireSubmit false): the first Stop resolves', async () => {
    const tw = createTurnWatcher();
    const w = tw.watch('term-2', { requireSubmit: false });
    tw.onEvent(evt('term-2', 'Stop'));
    expect(await w.done).toBe('stop');
  });

  test('SessionEnd resolves ended', async () => {
    const tw = createTurnWatcher();
    const w = tw.watch('term-3', { requireSubmit: true });
    tw.onEvent(evt('term-3', 'SessionEnd'));
    expect(await w.done).toBe('ended');
  });

  test('onLive: not counted ended before first sighting; ended once absent after being seen', async () => {
    const tw = createTurnWatcher();
    const w = tw.watch('term-4', { requireSubmit: false });
    tw.onLive([]);
    let settled = false;
    void w.done.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    tw.onLive(['term-4']);
    await Promise.resolve();
    expect(settled).toBe(false);

    tw.onLive([]);
    expect(await w.done).toBe('ended');
  });

  test('cancel detaches with no resolution; two watches on one terminal both resolve', async () => {
    const tw = createTurnWatcher();
    const cancelled = tw.watch('term-5', { requireSubmit: false });
    cancelled.cancel();
    let cancelledSettled = false;
    void cancelled.done.then(() => {
      cancelledSettled = true;
    });

    const a = tw.watch('term-6', { requireSubmit: false });
    const b = tw.watch('term-6', { requireSubmit: false });
    tw.onEvent(evt('term-6', 'Stop'));
    expect(await a.done).toBe('stop');
    expect(await b.done).toBe('stop');

    await Promise.resolve();
    expect(cancelledSettled).toBe(false);
  });
});

// -----------------------------------------------------------------------------------------------
// Flow fixtures — trimmed copies of `ade-dialog-rules.spec.ts`'s own builders.
// -----------------------------------------------------------------------------------------------

const DEFAULT_SETTINGS: Settings['ade'] = {
  panelWidth: 0,
  allAgentsFilter: 'active',
  horizonDays: 14,
  historyDays: 14,
  extraDays: [],
  offDays: [],
  workWeekendDays: [],
  workdayHours: 6,
  spanDayShare: 0.5,
};

function branch(
  overrides: Partial<AdeBranch> & Pick<AdeBranch, 'id' | 'branch' | 'kind'>,
): AdeBranch {
  return {
    name: '',
    draftTitle: '',
    startFrom: '',
    exists: true,
    ref: `refs/heads/${overrides.branch}`,
    tip: '0000000',
    owner: '',
    authorEmail: '',
    isMine: overrides.kind === 'mine',
    lastCommitAt: 0,
    base: '',
    ahead: 0,
    behind: 0,
    merged: false,
    mergedAt: null,
    worktree: '',
    files: [],
    commits: [],
    commitCount: 0,
    dirty: [],
    upstream: '',
    upstreamAhead: 0,
    upstreamBehind: 0,
    jira: { key: '', url: '' },
    prUrl: '',
    est: '',
    notes: '',
    addedAt: 0,
    ...overrides,
  };
}

function newWork(overrides: Partial<AdeNewWork> & Pick<AdeNewWork, 'id'>): AdeNewWork {
  return {
    title: '',
    startFrom: '',
    branchName: '',
    est: '',
    notes: '',
    jira: { key: '', url: '' },
    createdAt: 0,
    ...overrides,
  };
}

function plan(overrides: Partial<AdePlan> = {}): AdePlan {
  return { day: {}, order: [], queuedAfter: {}, unpushed: {}, ...overrides };
}

function snapshot(overrides: Partial<AdeRepoSnapshot> = {}): AdeRepoSnapshot {
  return {
    codeRepoId: 'repo',
    gitRepoId: 'repo',
    main: { name: 'main', ref: 'origin/main', tip: '0000000' },
    remote: 'origin',
    branches: [],
    newWork: [],
    plan: plan(),
    colors: {},
    pairs: [],
    history: [],
    lastFetchAt: null,
    autofetchMinutes: 0,
    worktreeBasePath: '~/wt/repo',
    ...overrides,
  };
}

const NO_PRS: AdeRepoPrs = { kind: 'ok', branches: {} };
const DEFAULT_STATE: DialogState = { msg: null, push: false, override: false, branchName: '' };

function ctxFor(snap: AdeRepoSnapshot): DialogCtx {
  const view = useQueue({
    snapshot: snap,
    sessions: [],
    activity: new Map(),
    prs: NO_PRS,
    settings: DEFAULT_SETTINGS,
    today: '2026-09-22',
    localDayOf: localIsoOfMs,
  });
  return { view, snapshot: snap, sessions: [], today: '2026-09-22', repoRoot: '' };
}

// -----------------------------------------------------------------------------------------------
// Fake deps
// -----------------------------------------------------------------------------------------------

interface FakeWatch extends TurnWatch {
  resolve: (outcome: TurnOutcome) => void;
  cancelled: boolean;
}

function fakeWatch(): FakeWatch {
  let resolve!: (outcome: TurnOutcome) => void;
  const done = new Promise<TurnOutcome>((res) => {
    resolve = res;
  });
  const w = { done, cancelled: false } as FakeWatch;
  w.cancel = () => {
    w.cancelled = true;
  };
  w.resolve = resolve;
  return w;
}

/** One watch per call, in call order — `watches[i]` is the i-th `turns.watch(...)` call. */
function fakeTurns(): { watch: SendDialogDeps['turns']['watch']; watches: FakeWatch[] } {
  const watches: FakeWatch[] = [];
  return {
    watch: () => {
      const w = fakeWatch();
      watches.push(w);
      return w;
    },
    watches,
  };
}

function fakeLaunch(
  opts: { failLaunchAt?: number; failSendFor?: string; launchStatus?: string } = {},
): {
  deps: LaunchDeps;
  calls: string[];
} {
  const calls: string[] = [];
  let launchCount = 0;
  const deps: LaunchDeps = {
    adeSend: async (args) => {
      calls.push(`send:${args.sessionId}`);
      if (opts.failSendFor === args.sessionId) throw new Error(`send failed: ${args.sessionId}`);
    },
    adePrepareLaunch: async (args) => {
      launchCount++;
      calls.push(`launch:${args.branch || args.newWorkId}`);
      if (opts.failLaunchAt === launchCount) throw new Error('prepare launch failed');
      return {
        terminalId: `term-${launchCount}`,
        sessionId: `sess-${launchCount}`,
        command: 'claude',
      };
    },
    openTerminalSession: async () => {},
    terminalSession: () => ({ status: opts.launchStatus ?? 'running', error: 'boom' }),
  };
  return { deps, calls };
}

function baseDeps(overrides: Partial<SendDialogDeps> & { ctx: DialogCtx }): SendDialogDeps {
  return {
    launch: fakeLaunch().deps,
    turns: { watch: () => fakeWatch() },
    setQueuedAfter: async () => {},
    updateNewWork: async () => {},
    rebasing: { add: () => {}, remove: () => {} },
    dropRoots: () => {},
    setError: () => {},
    closeDialog: () => {},
    archive: async () => {},
    fetchArchiveRisk: async () => ({ dirty: [], unmerged: 0, worktree: '' }),
    openDialog: () => {},
    setPendingArchive: () => {},
    clearPendingArchive: () => {},
    setActionError: () => {},
    ...overrides,
  };
}

// -----------------------------------------------------------------------------------------------
// Flows
// -----------------------------------------------------------------------------------------------

describe('dialogFlow', () => {
  test('rebase all over 2 roots: two deliveries in order, rebasing holds both then clears each on its own Stop', async () => {
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine' }),
        branch({ id: 'b', branch: 'feat/b', kind: 'mine' }),
      ],
    });
    const ctx = ctxFor(snap);
    const spec = rebaseSpec(ctx, ['a', 'b'], 'main', 'Rebase all onto main');
    const { deps: launch, calls } = fakeLaunch();
    const turns = fakeTurns();
    const rebasingSet = new Set<string>();

    await sendDialog(
      baseDeps({
        ctx,
        launch,
        turns,
        rebasing: { add: (r) => rebasingSet.add(r), remove: (r) => rebasingSet.delete(r) },
      }),
      spec,
      DEFAULT_STATE,
    );

    expect(calls).toEqual(['launch:a', 'launch:b']);
    expect(rebasingSet.has('a')).toBe(true);
    expect(rebasingSet.has('b')).toBe(true);
    expect(turns.watches.length).toBe(2);

    turns.watches[0]?.resolve('stop');
    await turns.watches[0]?.done;
    expect(rebasingSet.has('a')).toBe(false);
    expect(rebasingSet.has('b')).toBe(true);

    turns.watches[1]?.resolve('stop');
    await turns.watches[1]?.done;
    expect(rebasingSet.has('b')).toBe(false);
  });

  test('queue kind calls SetQueuedAfter after a successful delivery only; main onto never calls it', async () => {
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine' }),
        branch({ id: 'r', branch: 'feat/r', kind: 'review' }),
      ],
    });
    const ctx = ctxFor(snap);

    const queueSpec = rebaseSpec(ctx, ['a'], 'r', 'Queue after feat/r');
    expect(queueSpec.kind).toBe('queue');
    const setQueuedAfterCalls: unknown[] = [];
    await sendDialog(
      baseDeps({
        ctx,
        launch: fakeLaunch().deps,
        setQueuedAfter: async (args) => {
          setQueuedAfterCalls.push(args);
        },
      }),
      queueSpec,
      DEFAULT_STATE,
    );
    expect(setQueuedAfterCalls).toEqual([{ codeRepoId: 'repo', item: 'a', after: 'r' }]);

    const rebaseSpecMain = rebaseSpec(ctx, ['a'], 'main', 'Rebase onto main');
    const mainCalls: unknown[] = [];
    await sendDialog(
      baseDeps({
        ctx,
        launch: fakeLaunch().deps,
        setQueuedAfter: async (args) => {
          mainCalls.push(args);
        },
      }),
      rebaseSpecMain,
      DEFAULT_STATE,
    );
    expect(mainCalls).toEqual([]);
  });

  test('second delivery fails: first root dropped from the spec, error set, dialog stays open, failed root leaves rebasing', async () => {
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine' }),
        branch({ id: 'b', branch: 'feat/b', kind: 'mine' }),
      ],
    });
    const ctx = ctxFor(snap);
    const spec = rebaseSpec(ctx, ['a', 'b'], 'main', 'Rebase all onto main');
    const { deps: launch } = fakeLaunch({ failLaunchAt: 2 });
    const rebasingSet = new Set(['a', 'b']);
    let droppedIds: string[] | null = null;
    let errorMessage: string | null = null;
    let closed = false;

    await sendDialog(
      baseDeps({
        ctx,
        launch,
        rebasing: { add: (r) => rebasingSet.add(r), remove: (r) => rebasingSet.delete(r) },
        dropRoots: (sent) => {
          droppedIds = sent;
        },
        setError: (msg) => {
          errorMessage = msg;
        },
        closeDialog: () => {
          closed = true;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    // tsgo's own CFA narrows a `let x: T | null = null` only ever reassigned inside a closure
    // down to `null`/`never` at the read site (same quirk `dialogFlow.ts`'s own `watch` variable
    // hit) — the cast defeats it, same fix.
    expect(droppedIds as string[] | null).toEqual(['a']);
    expect(errorMessage as string | null).toBe('prepare launch failed');
    expect(closed).toBe(false);
    expect(rebasingSet.has('a')).toBe(true);
    expect(rebasingSet.has('b')).toBe(false);
  });

  test('draft start with a branch name: UpdateNewWork lands before PrepareLaunch; an empty name skips it', async () => {
    const snap = snapshot({ newWork: [newWork({ id: 'd', title: 'New work' })] });
    const ctx = ctxFor(snap);
    const spec = startSpec(ctx, 'd');

    const calls: string[] = [];
    const { deps: launch } = fakeLaunch();
    const launchWithLog: LaunchDeps = {
      ...launch,
      adePrepareLaunch: async (args) => {
        calls.push(`launch:${args.newWorkId}`);
        return { terminalId: 'term-1', sessionId: 'sess-1', command: 'claude' };
      },
    };
    await sendDialog(
      baseDeps({
        ctx,
        launch: launchWithLog,
        updateNewWork: async (args) => {
          calls.push(`updateNewWork:${args.id}`);
        },
      }),
      spec,
      { ...DEFAULT_STATE, branchName: 'feat/x' },
    );
    expect(calls).toEqual(['updateNewWork:d', 'launch:d']);

    calls.length = 0;
    await sendDialog(
      baseDeps({
        ctx,
        launch: launchWithLog,
        updateNewWork: async (args) => {
          calls.push(`updateNewWork:${args.id}`);
        },
      }),
      spec,
      { ...DEFAULT_STATE, branchName: '   ' },
    );
    expect(calls).toEqual(['launch:d']);
  });

  test('launch with status failed: the armed watch is cancelled and the error surfaces', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = rebaseSpec(ctx, ['a'], 'main', 'Rebase onto main');
    const { deps: launch } = fakeLaunch({ launchStatus: 'failed' });
    const turns = fakeTurns();
    let errorMessage: string | null = null;

    await sendDialog(
      baseDeps({
        ctx,
        launch,
        turns,
        setError: (msg) => {
          errorMessage = msg;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    expect(turns.watches.length).toBe(1);
    expect(turns.watches[0]?.cancelled).toBe(true);
    expect(errorMessage as string | null).toBe('boom');
  });

  test('archive: nothing at risk archives directly, no dialog', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let archived: unknown = null;
    let dialogOpened = false;
    await requestArchive(
      baseDeps({
        ctx,
        fetchArchiveRisk: async () => ({ dirty: [], unmerged: 0, worktree: '~/wt/a' }),
        archive: async (args) => {
          archived = args;
        },
        openDialog: () => {
          dialogOpened = true;
        },
      }),
      'a',
    );
    expect(archived).toEqual({ item: 'a', discard: false });
    expect(dialogOpened).toBe(false);
  });

  test('archive: blocked goes to actionError, no archive call', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let archiveCalled = false;
    let actionError: string | null = null;
    await requestArchive(
      baseDeps({
        ctx,
        fetchArchiveRisk: async () => ({ dirty: [], unmerged: 0, worktree: '', blocked: 'locked' }),
        archive: async () => {
          archiveCalled = true;
        },
        setActionError: (msg) => {
          actionError = msg;
        },
      }),
      'a',
    );
    expect(archiveCalled).toBe(false);
    expect(actionError as string | null).toBe("Can't archive: locked");
  });

  test('archive: at risk opens the dialog', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let archiveCalled = false;
    let openedSpec: DialogSpec | null = null;
    await requestArchive(
      baseDeps({
        ctx,
        fetchArchiveRisk: async () => ({ dirty: ['a.txt'], unmerged: 2, worktree: '~/wt/a' }),
        archive: async () => {
          archiveCalled = true;
        },
        openDialog: (spec) => {
          openedSpec = spec;
        },
      }),
      'a',
    );
    expect(archiveCalled).toBe(false);
    expect((openedSpec as DialogSpec | null)?.kind).toBe('archive');
    expect((openedSpec as DialogSpec | null)?.branch).toBe('a');
  });

  test('justDeleteArchive uses discard: true and closes', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let archived: unknown = null;
    let closed = false;
    await justDeleteArchive(
      baseDeps({
        ctx,
        archive: async (args) => {
          archived = args;
        },
        closeDialog: () => {
          closed = true;
        },
      }),
      'a',
    );
    expect(archived).toEqual({ item: 'a', discard: true });
    expect(closed).toBe(true);
  });

  test('send-then-archive: archives only after Stop', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = archiveSpec(ctx, 'a', { dirty: ['a.txt'], unmerged: 0, worktree: '~/wt/a' });
    const turns = fakeTurns();
    const archiveCalls: unknown[] = [];
    let closed = false;

    await sendDialog(
      baseDeps({
        ctx,
        turns,
        archive: async (args) => {
          archiveCalls.push(args);
        },
        closeDialog: () => {
          closed = true;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    expect(closed).toBe(true);
    expect(archiveCalls).toEqual([]);

    turns.watches[0]?.resolve('stop');
    await turns.watches[0]?.done;
    await Promise.resolve();
    expect(archiveCalls).toEqual([{ item: 'a', discard: false }]);
  });

  test('send-then-archive: after-Stop atRisk reopens with fresh risk and the same target choice', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = archiveSpec(ctx, 'a', { dirty: ['a.txt'], unmerged: 0, worktree: '~/wt/a' });
    const turns = fakeTurns();
    let openedSpec: DialogSpec | null = null;
    let riskCallCount = 0;

    await sendDialog(
      baseDeps({
        ctx,
        turns,
        archive: async () => {
          throw new Error('worktree has uncommitted changes');
        },
        fetchArchiveRisk: async () => {
          riskCallCount++;
          return { dirty: ['a.txt', 'b.txt'], unmerged: 0, worktree: '~/wt/a' };
        },
        openDialog: (s) => {
          openedSpec = s;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    turns.watches[0]?.resolve('stop');
    await turns.watches[0]?.done;
    await Promise.resolve();
    await Promise.resolve();

    expect(riskCallCount).toBe(1);
    const reopened = openedSpec as DialogSpec | null;
    expect(reopened?.kind).toBe('archive');
    expect(reopened?.risk?.dirty).toEqual(['a.txt', 'b.txt']);
    expect(reopened?.targets[0]?.choice).toBe('new');
  });

  test("send-then-archive: 'ended' sets actionError and archives nothing", async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = archiveSpec(ctx, 'a', { dirty: ['a.txt'], unmerged: 0, worktree: '~/wt/a' });
    const turns = fakeTurns();
    let archiveCalled = false;
    let actionError: string | null = null;

    await sendDialog(
      baseDeps({
        ctx,
        turns,
        archive: async () => {
          archiveCalled = true;
        },
        setActionError: (msg) => {
          actionError = msg;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    turns.watches[0]?.resolve('ended');
    await turns.watches[0]?.done;
    await Promise.resolve();

    expect(archiveCalled).toBe(false);
    expect(actionError as string | null).toBe(
      "Claude's session ended before archiving; archive again when ready",
    );
  });

  // §0.14/§3.3: the Move dialog applies the plan (`spec.applyPlan`) before delivery, both awaited
  // before close — `SetPlan` is idempotent, so a delivery retry after a successful `applyPlan`
  // re-delivers without ever re-applying a stale plan (never the other order).
  test('move: applyPlan runs before delivery', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const order: string[] = [];
    const spec = moveSpec(ctx, ['a'], null, '2026-09-23', async () => {
      order.push('applyPlan');
    });
    const { deps: launch } = fakeLaunch();
    const launchWithLog: LaunchDeps = {
      ...launch,
      adePrepareLaunch: async (args) => {
        order.push('deliver');
        return launch.adePrepareLaunch(args);
      },
    };

    await sendDialog(baseDeps({ ctx, launch: launchWithLog }), spec, DEFAULT_STATE);

    expect(order).toEqual(['applyPlan', 'deliver']);
  });

  test('move: applyPlan rejecting sets the error, skips delivery, dialog stays open', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = moveSpec(ctx, ['a'], null, '2026-09-23', async () => {
      throw new Error('plan write failed');
    });
    const { deps: launch, calls } = fakeLaunch();
    let errorMessage: string | null = null;
    let closed = false;

    await sendDialog(
      baseDeps({
        ctx,
        launch,
        setError: (msg) => {
          errorMessage = msg;
        },
        closeDialog: () => {
          closed = true;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    expect(calls).toEqual([]);
    expect(closed).toBe(false);
    expect(errorMessage as string | null).toBe('plan write failed');
  });

  test('move: delivery rejecting after applyPlan resolved sets the error', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let applyPlanCalls = 0;
    const spec = moveSpec(ctx, ['a'], null, '2026-09-23', async () => {
      applyPlanCalls++;
    });
    const { deps: launch } = fakeLaunch({ failLaunchAt: 1 });
    let errorMessage: string | null = null;

    await sendDialog(
      baseDeps({
        ctx,
        launch,
        setError: (msg) => {
          errorMessage = msg;
        },
      }),
      spec,
      DEFAULT_STATE,
    );

    expect(applyPlanCalls).toBe(1);
    expect(errorMessage as string | null).toBe('prepare launch failed');
  });

  test('move: retrying after a delivery failure re-applies the plan and delivers once', async () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    let applyPlanCalls = 0;
    const spec = moveSpec(ctx, ['a'], null, '2026-09-23', async () => {
      applyPlanCalls++;
    });
    const { deps: launch, calls } = fakeLaunch({ failLaunchAt: 1 });
    let closed = false;
    const deps = baseDeps({
      ctx,
      launch,
      closeDialog: () => {
        closed = true;
      },
    });

    await sendDialog(deps, spec, DEFAULT_STATE);
    expect(applyPlanCalls).toBe(1);
    expect(closed).toBe(false);

    await sendDialog(deps, spec, DEFAULT_STATE);
    expect(applyPlanCalls).toBe(2);
    expect(closed).toBe(true);
    expect(calls.filter((c) => c.startsWith('launch:')).length).toBe(2);
  });
});
