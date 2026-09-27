import { describe, expect, test } from 'bun:test';
import type { AgentActivity } from '@shared/domain/agent';
import {
  composeDialog,
  type DialogCtx,
  type DialogSpec,
  type DialogState,
  messageForRoot,
  rebaseSpec,
  startSpec,
  wtOf,
} from '../../frontend/src/ade/dialogCompose';
import { useQueue } from '../../frontend/src/ade/useQueue';
import type {
  AdeBranch,
  AdeNewWork,
  AdePlan,
  AdeRepoPrs,
  AdeRepoSnapshot,
  AdeSession,
} from '../../frontend/src/ade/wire';
import type { Settings } from '../../frontend/src/state/settingsDomain';

// P129 Part 4 §3.2 — hand-computed cases the mockup can't reach (it has no remote toggle, no
// `worktreeBasePath`/`AdeBranch.worktree` distinction, and never inspects the message it sends).
// Fixture builders mirror `ade-queue-rules.spec.ts`'s own shape (Part 3's precedent).

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
const NO_ACTIVITY: ReadonlyMap<string, AgentActivity> = new Map();
const DEFAULT_STATE: DialogState = { msg: null, push: false, override: false, branchName: '' };

function ctxFor(
  snap: AdeRepoSnapshot,
  sessions: readonly AdeSession[] = [],
  opts: { repoRoot?: string; selectedId?: string } = {},
): DialogCtx {
  const view = useQueue({
    snapshot: snap,
    sessions,
    activity: NO_ACTIVITY,
    prs: NO_PRS,
    settings: DEFAULT_SETTINGS,
    today: '2026-09-22',
    selectedId: opts.selectedId,
  });
  return { view, snapshot: snap, sessions, today: '2026-09-22', repoRoot: opts.repoRoot ?? '' };
}

function session(overrides: Partial<AdeSession> & Pick<AdeSession, 'id' | 'branch'>): AdeSession {
  return {
    claudeSessionId: overrides.id,
    codeRepoId: 'repo',
    newWorkId: '',
    cwd: '',
    state: 'running',
    terminalId: overrides.id,
    startedAt: 0,
    lastActiveAt: 0,
    ...overrides,
  };
}

describe('ade-dialog-rules', () => {
  test('1. no remote: rebase, queue and draft lines drop the fetch step (§0.3)', () => {
    const snap = snapshot({
      remote: '',
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    const ctx = ctxFor(snap);
    const rebase = rebaseSpec(ctx, ['a'], 'main', 'Rebase onto main');
    const view = composeDialog(ctx, rebase, DEFAULT_STATE, NO_ACTIVITY);
    expect(view.message).toContain('1. In ~/wt/repo/a: git rebase origin/main');
    expect(view.message).not.toContain('fetch');

    const snapDraft = snapshot({
      remote: '',
      newWork: [newWork({ id: 'd', title: 'Draft work' })],
    });
    const ctxDraft = ctxFor(snapDraft);
    const draftSpec = startSpec(ctxDraft, 'd');
    const draftView = composeDialog(
      ctxDraft,
      draftSpec,
      { ...DEFAULT_STATE, branchName: 'feat/x' },
      NO_ACTIVITY,
    );
    expect(draftView.message).toContain(
      'Create branch feat/x from origin/main in a new worktree at ~/wt/repo/x',
    );
    expect(draftView.message).not.toContain('fetch');
  });

  test('2. local-only main (ref === name) and a master main', () => {
    const snapLocal = snapshot({
      main: { name: 'main', ref: 'main', tip: '0' },
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    const localView = composeDialog(
      ctxFor(snapLocal),
      rebaseSpec(ctxFor(snapLocal), ['a'], 'main', 'Rebase onto main'),
      DEFAULT_STATE,
      NO_ACTIVITY,
    );
    expect(localView.message).toContain('git rebase main');

    const snapMaster = snapshot({
      main: { name: 'master', ref: 'origin/master', tip: '0' },
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    const ctxMaster = ctxFor(snapMaster);
    const masterView = composeDialog(
      ctxMaster,
      rebaseSpec(ctxMaster, ['a'], 'main', 'Rebase onto main'),
      DEFAULT_STATE,
      NO_ACTIVITY,
    );
    expect(masterView.message).toContain('Rebase feat/a onto master.');
    expect(masterView.message).toContain('git rebase origin/master');
  });

  test('3. worktreeBasePath empty uses the repo root; a trailing slash is trimmed', () => {
    const snapEmpty = snapshot({
      worktreeBasePath: '',
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    expect(wtOf(ctxFor(snapEmpty, [], { repoRoot: '/home/dev/repo' }), 'a')).toBe(
      '/home/dev/repo/a',
    );

    const snapTrailing = snapshot({
      worktreeBasePath: '~/wt/repo/',
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    expect(wtOf(ctxFor(snapTrailing), 'a')).toBe('~/wt/repo/a');
  });

  test('4. a real AdeBranch.worktree wins over the computed wtOf path', () => {
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine', worktree: '/custom/elsewhere' }),
      ],
    });
    expect(wtOf(ctxFor(snap), 'a')).toBe('/custom/elsewhere');
  });

  test('5. bare Jira key (no URL); no Jira; draft without notes', () => {
    const snapKey = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine', jira: { key: 'ABC-1', url: '' } }),
      ],
    });
    const ctxKey = ctxFor(snapKey);
    const viewKey = composeDialog(ctxKey, startSpec(ctxKey, 'a'), DEFAULT_STATE, NO_ACTIVITY);
    expect(viewKey.message).toContain('- Jira: ABC-1');
    expect(viewKey.message).not.toContain('http');

    const snapNoJira = snapshot({
      branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })],
    });
    const ctxNoJira = ctxFor(snapNoJira);
    const viewNoJira = composeDialog(
      ctxNoJira,
      startSpec(ctxNoJira, 'a'),
      DEFAULT_STATE,
      NO_ACTIVITY,
    );
    expect(viewNoJira.message).not.toContain('Jira');

    const snapDraft = snapshot({ newWork: [newWork({ id: 'd', title: 'No notes here' })] });
    const ctxDraftNoNotes = ctxFor(snapDraft);
    const viewDraftNoNotes = composeDialog(
      ctxDraftNoNotes,
      startSpec(ctxDraftNoNotes, 'd'),
      DEFAULT_STATE,
      NO_ACTIVITY,
    );
    expect(viewDraftNoNotes.message).not.toContain('Notes');
  });

  test('6. multi-root split (§0.13): unedited per-root, edited strips verbatim blocks, single root unchanged', () => {
    const snap = snapshot({
      branches: [
        branch({ id: 'a', branch: 'feat/a', kind: 'mine' }),
        branch({ id: 'b', branch: 'feat/b', kind: 'mine' }),
      ],
    });
    const ctx = ctxFor(snap);
    const multi = rebaseSpec(ctx, ['a', 'b'], 'main', 'Rebase all onto main');

    // Unedited: root b's own delivered text is the single-root template for just b.
    const forB = messageForRoot(ctx, multi, 'b', { msg: null, push: false });
    const single = rebaseSpec(ctx, ['b'], 'main', 'Rebase onto main');
    const singleTemplate = composeDialog(ctx, single, DEFAULT_STATE, NO_ACTIVITY).message;
    expect(forB).toBe(singleTemplate);
    expect(forB).not.toContain('feat/a');

    // Edited, with both blocks verbatim: stripping a's block leaves b's own text intact.
    const template = composeDialog(ctx, multi, DEFAULT_STATE, NO_ACTIVITY).message;
    const editedVerbatim = `Heads up before you start.\n\n${template}`;
    const strippedForB = messageForRoot(ctx, multi, 'b', { msg: editedVerbatim, push: false });
    expect(strippedForB).not.toContain('feat/a');
    expect(strippedForB).toContain('feat/b');
    expect(strippedForB).toContain('Heads up before you start.');

    // Edited, with a's own block edited away (no longer verbatim): goes through as-is for b.
    const editedAway = editedVerbatim.replace(
      'Rebase feat/a onto main.',
      'Rebase feat/a onto main, carefully.',
    );
    const asIsForB = messageForRoot(ctx, multi, 'b', { msg: editedAway, push: false });
    expect(asIsForB).toBe(editedAway);
    expect(asIsForB).toContain('feat/a');

    // Single root: message passes through unchanged regardless of edited state.
    const singleSpec = rebaseSpec(ctx, ['a'], 'main', 'Rebase onto main');
    expect(messageForRoot(ctx, singleSpec, 'a', { msg: null, push: false })).toBe(
      composeDialog(ctx, singleSpec, DEFAULT_STATE, NO_ACTIVITY).message,
    );
    expect(messageForRoot(ctx, singleSpec, 'a', { msg: 'hand edit', push: false })).toBe(
      'hand edit',
    );
  });

  test('7. target fallback: a stopped/unknown choice goes to the first running option, else "new"', () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const sessions = [session({ id: 'running-1', branch: 'feat/a', state: 'running' })];
    const ctx = ctxFor(snap, sessions);
    const spec: DialogSpec = {
      ...startSpec(ctx, 'a'),
      targets: [{ item: 'a', choice: 'stopped-and-gone' }],
    };
    const view = composeDialog(ctx, spec, DEFAULT_STATE, NO_ACTIVITY);
    expect(view.targets[0]?.options.find((o) => o.on)?.label).toBe('claude running- (only agent)');

    const ctxNoSessions = ctxFor(snap, []);
    const specNoSessions: DialogSpec = {
      ...startSpec(ctxNoSessions, 'a'),
      targets: [{ item: 'a', choice: 'anything' }],
    };
    const viewNoSessions = composeDialog(ctxNoSessions, specNoSessions, DEFAULT_STATE, NO_ACTIVITY);
    expect(viewNoSessions.targets[0]?.options).toEqual([
      { value: 'new', label: 'new session', on: true },
    ]);
  });

  test('8. a blank (trimmed) message disables Send', () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const ctx = ctxFor(snap);
    const spec = startSpec(ctx, 'a');
    expect(composeDialog(ctx, spec, DEFAULT_STATE, NO_ACTIVITY).sendDisabled).toBe(false);
    expect(
      composeDialog(ctx, spec, { ...DEFAULT_STATE, msg: '   ' }, NO_ACTIVITY).sendDisabled,
    ).toBe(true);
    expect(composeDialog(ctx, spec, { ...DEFAULT_STATE, msg: '' }, NO_ACTIVITY).sendDisabled).toBe(
      true,
    );
    expect(
      composeDialog(ctx, spec, { ...DEFAULT_STATE, msg: 'go' }, NO_ACTIVITY).sendDisabled,
    ).toBe(false);
  });

  test("9. idle/input sessions don't block; a stopped session is ignored", () => {
    const snap = snapshot({ branches: [branch({ id: 'a', branch: 'feat/a', kind: 'mine' })] });
    const sessions = [
      session({ id: 'idle-1', branch: 'feat/a', state: 'running' }),
      session({ id: 'input-1', branch: 'feat/a', state: 'running' }),
      session({ id: 'stopped-1', branch: 'feat/a', state: 'stopped' }),
    ];
    const activity: ReadonlyMap<string, AgentActivity> = new Map([
      [
        'idle-1',
        {
          phase: 'idle',
          runningTools: [],
          toolName: null,
          message: null,
          sessionId: null,
          wakeArmed: false,
          at: 0,
        },
      ],
      [
        'input-1',
        {
          phase: 'attention',
          runningTools: [],
          toolName: null,
          message: null,
          sessionId: null,
          wakeArmed: false,
          at: 0,
        },
      ],
    ]);
    const ctx = ctxFor(snap, sessions);
    const spec = rebaseSpec(ctx, ['a'], 'main', 'Rebase onto main');
    const view = composeDialog(ctx, spec, DEFAULT_STATE, activity);
    expect(view.busy).toEqual([]);
    expect(view.blocked).toBe(false);
  });
});
