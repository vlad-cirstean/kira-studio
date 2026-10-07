import { describe, expect, test } from 'bun:test';
import { buildBranchGraph } from '../../frontend/src/ade/v2/board/branchGraph';
import {
  archiveSpec,
  composeDialog,
  type DialogCtx,
  mergeSpec,
  rebaseSpec,
  stageSpec,
  startSpec,
  templateFor,
} from '../../frontend/src/ade/v2/dialog/compose';
import { createTurnWatcher } from '../../frontend/src/ade/v2/dialog/turnWatch';
import type {
  Board,
  ReposResult,
  Session,
  SessionsResult,
  Stage,
} from '../../frontend/src/ade/v2/wire';
import { loadFixture } from './support/adeV2Fixtures';
import { runMockupV2 } from './support/mockupV2Oracle';

// The dialog templates against the mockup run unmodified (rebase with a restack chain, queue onto a
// review branch, merge), then the rules the mockup has no oracle for: busy and headless blocks,
// target resolution, archive lines and the stage and start mirrors of the server defaults. The turn
// watcher's submit / stop / ended / live-seen rules close the file.

const board = loadFixture<Board>('board');
const repos = loadFixture<ReposResult>('repos').repos;
const graph = buildBranchGraph(board);
const NICK = new Map(repos.map((r) => [r.codeRepoId, r.nickname || r.name]));

function ctxWith(sessions: Session[], repoName?: (id: string) => string): DialogCtx {
  return {
    graph,
    sessions,
    worktreeBasePath: board.worktreeBasePath,
    repoState: (id) => {
      const st = board.repos.find((r) => r.codeRepoId === id);
      return { mainName: st?.mainName ?? '', remote: st?.remote ?? '' };
    },
    repo: (id) => ({
      nick: NICK.get(id) ?? id,
      // The mockup's worktree paths use the nickname as the directory segment.
      name: repoName ? repoName(id) : (NICK.get(id) ?? id),
      root: repos.find((r) => r.codeRepoId === id)?.path ?? '',
    }),
    taskTitle: (id) => board.tasks.find((t) => t.id === id)?.title || 'Usage-based billing',
    openStep: () => 'Metering endpoints',
  };
}

const ctx = ctxWith(loadFixture<SessionsResult>('sessions').sessions);
const STATE = { msg: null, push: false, override: false };

function mockupMessage(dialog: Record<string, unknown>, push = false): string {
  return runMockupV2({ dialog, dialogPush: push }).dialog.message as string;
}

describe('templates equal the mockup', () => {
  test('rebase with a restack chain, push off and on', () => {
    const spec = rebaseSpec(ctx, 'b_bill', 'main', 'Rebase onto main');
    for (const push of [false, true]) {
      const want = mockupMessage(
        {
          kind: 'rebase',
          roots: ['b_bill'],
          onto: 'main',
          ids: ['b_bill', 'b_billdash'],
          targets: [{ branch: 'b_bill', choice: 'new' }],
          title: 'Rebase onto main',
        },
        push,
      );
      expect(templateFor(ctx, spec, { ...STATE, push })).toBe(want);
    }
  });

  test('queue onto a review branch adds the do-not-modify line', () => {
    const spec = rebaseSpec(ctx, 'b_search', 'b_li', 'Queue after li/search-schema');
    expect(spec.kind).toBe('queue');
    const want = mockupMessage({
      kind: 'queue',
      roots: ['b_search'],
      onto: 'b_li',
      ids: ['b_search', 'b_searchui'],
      targets: [{ branch: 'b_search', choice: 'new' }],
      title: 'Queue after li/search-schema',
    });
    expect(templateFor(ctx, spec, STATE)).toBe(want);
    expect(want).toContain('Do not modify li/search-schema.');
  });

  test('merge of a stale branch, push off and on', () => {
    const spec = mergeSpec(ctx, 'b_auth', 'develop');
    expect(spec.title).toBe('Re-merge into develop');
    for (const push of [false, true]) {
      const want = mockupMessage(
        {
          kind: 'merge',
          branch: 'b_auth',
          target: 'develop',
          targets: [{ branch: 'b_auth', choice: 'new' }],
          title: 'Re-merge into develop',
        },
        push,
      );
      expect(templateFor(ctx, spec, { ...STATE, push })).toBe(want);
    }
  });
});

describe('merge path', () => {
  test('uses the repo name with slashes as dashes, not the nickname', () => {
    const c = ctxWith([], (id) => (id === 'repo-web-app' ? 'acme/web-app' : id));
    const text = templateFor(c, mergeSpec(c, 'b_auth', 'develop'), STATE);
    expect(text).toContain('~/wt/acme-web-app/_develop');
    expect(text).toContain('git worktree add ~/wt/acme-web-app/_develop origin/develop -B develop');
  });

  test('the push switch prints the push line and the label names the target', () => {
    const spec = mergeSpec(ctx, 'b_auth', 'develop');
    const off = composeDialog(ctx, spec, STATE);
    const on = composeDialog(ctx, spec, { ...STATE, push: true });
    expect(off.pushLabel).toBe('Also push develop');
    expect(off.message).toContain('Do not push.');
    expect(on.message).toContain('Then push: git push origin develop');
  });
});

describe('busy and headless blocks', () => {
  const tui = (over: Partial<Session>): Session => ({
    id: 'aaaa1111',
    claudeSessionId: 'c',
    mode: 'tui',
    state: 'running',
    activity: 'working',
    terminalId: 't1',
    taskId: 'T_bill',
    branchId: 'b_billdash',
    stageId: '',
    stepId: '',
    runId: '',
    resumes: '',
    purpose: '',
    cwd: '',
    cwdMissing: false,
    startedAt: 0,
    lastActiveAt: 0,
    ...over,
  });

  test('a working TUI session on a stacked branch blocks until overridden', () => {
    const c = ctxWith([tui({})]);
    const spec = rebaseSpec(c, 'b_bill', 'main', 'Rebase onto main');
    const blocked = composeDialog(c, spec, STATE);
    expect(blocked.blocked).toBe(true);
    expect(blocked.busy[0]?.text).toBe('web-app · feat/billing-dashboard · claude aaaa · working');
    const over = composeDialog(c, spec, { ...STATE, override: true });
    expect(over.blocked).toBe(false);
    expect(over.sendLabel).toBe('Send anyway');
    expect(over.overrideLabel).toBe('Undo override');
  });

  test('an idle or input session does not block', () => {
    const c = ctxWith([tui({ activity: 'input' }), tui({ id: 'bbbb', activity: 'idle' })]);
    expect(composeDialog(c, rebaseSpec(c, 'b_bill', 'main', 't'), STATE).blocked).toBe(false);
  });

  test('a running headless run blocks with no override', () => {
    const c = ctxWith([
      tui({ mode: 'headless', terminalId: '', runId: 'r1', activity: 'working' }),
    ]);
    const v = composeDialog(c, rebaseSpec(c, 'b_bill', 'main', 't'), { ...STATE, override: true });
    expect(v.blocked).toBe(true);
    expect(v.headless).toBe(
      'A background run is active on feat/billing-dashboard. Stop it in Sessions, or wait.',
    );
  });

  test('a stopped headless run does not block', () => {
    const c = ctxWith([tui({ mode: 'headless', state: 'stopped', terminalId: '' })]);
    expect(composeDialog(c, rebaseSpec(c, 'b_bill', 'main', 't'), STATE).blocked).toBe(false);
  });
});

describe('targets', () => {
  const running = (id: string, branchId: string): Session => ({
    id,
    claudeSessionId: id,
    mode: 'tui',
    state: 'running',
    activity: 'idle',
    terminalId: `t-${id}`,
    taskId: 'T_bill',
    branchId,
    stageId: '',
    stepId: '',
    runId: '',
    resumes: '',
    purpose: '',
    cwd: '',
    cwdMissing: false,
    startedAt: 0,
    lastActiveAt: 0,
  });

  test('no running session offers a new one', () => {
    const v = composeDialog(ctxWith([]), rebaseSpec(ctxWith([]), 'b_bill', 'main', 't'), STATE);
    expect(v.targets[0]?.options).toEqual([{ value: 'new', label: 'new session', on: true }]);
  });

  test('one running session is the only agent and the default', () => {
    const c = ctxWith([running('9ab01234', 'b_bill')]);
    const v = composeDialog(c, rebaseSpec(c, 'b_bill', 'main', 't'), STATE);
    expect(v.targets[0]?.options).toEqual([
      { value: '9ab01234', label: 'claude 9ab0 (only agent)', on: true },
    ]);
  });

  test('a stored choice that stopped falls back to the first running one', () => {
    const c = ctxWith([running('aaaa', 'b_bill'), running('bbbb', 'b_bill')]);
    const spec = rebaseSpec(c, 'b_bill', 'main', 't');
    spec.targets = [{ branchId: 'b_bill', choice: 'gone' }];
    const v = composeDialog(c, spec, STATE);
    expect(v.targets[0]?.options.map((o) => o.on)).toEqual([true, false]);
  });
});

describe('archive', () => {
  test('lists only branches at risk and builds the risk line', () => {
    const spec = archiveSpec(ctx, {
      taskId: 'T_bill',
      branches: [
        {
          branchId: 'b_bill',
          worktree: '~/wt/web-app/usage-billing',
          dirty: [{ code: 'M', path: 'src/a.ts' }],
          unmerged: 5,
          blocked: '',
        },
        {
          branchId: 'b_meter',
          worktree: '~/wt/api/usage-metering',
          dirty: [],
          unmerged: 0,
          blocked: '',
        },
      ],
    });
    expect(spec.targets.map((t) => t.branchId)).toEqual(['b_bill']);
    const v = composeDialog(ctx, spec, STATE);
    expect(v.riskText).toBe('web-app: 1 uncommitted, 5 unmerged commits');
    expect(v.message).toBe(
      [
        'Task "Usage-based billing" is being archived and its worktrees will be deleted.',
        '- web-app · feat/usage-billing · ~/wt/web-app/usage-billing · uncommitted: src/a.ts · commits not merged into main: 5',
        'Before they are deleted: ',
      ].join('\n'),
    );
    expect(v.sendLabel).toBe('Send to Claude, then archive');
  });
});

describe('stage and start mirror the server defaults', () => {
  const stage: Stage = {
    id: 'spec',
    name: 'Spec',
    kind: 'user',
    status: 'In progress',
    skip: false,
    session: true,
    prompt: 'Ask me questions until the spec is clear about {task} in {repo}.',
    steps: [],
    command: '',
    runsOn: '',
    onFailure: '',
    timeout: '',
  };

  test('stage: title line, Jira, writable and read-only repos, notes, substituted prompt', () => {
    const t = board.tasks.find((x) => x.id === 'T_bill');
    if (!t) throw new Error('fixture');
    const g = buildBranchGraph({
      ...board,
      tasks: board.tasks.map((x) =>
        x.id === 'T_bill'
          ? {
              ...x,
              notes: 'Reuse line items.',
              jira: { key: 'PAY-102', url: 'https://j/PAY-102' },
              currentStage: stage,
            }
          : x,
      ),
    });
    const c = { ...ctx, graph: g };
    const text = templateFor(c, stageSpec(c, 'T_bill'), STATE);
    expect(text.split('\n')).toEqual([
      'Spec: Usage-based billing',
      '- Jira: PAY-102 https://j/PAY-102',
      '- Repo: api · Branch: feat/usage-metering · Worktree: ~/wt/api/usage-metering',
      '- Repo: web-app · Branch: feat/usage-billing · Worktree: ~/wt/web-app/usage-billing',
      '- Repo: web-app · Branch: feat/billing-dashboard · Worktree: ~/wt/web-app/billing-dashboard',
      '- Notes: Reuse line items.',
      'Ask me questions until the spec is clear about Usage-based billing in api, web-app, web-app.',
    ]);
    expect(stageSpec(c, 'T_bill').title).toBe('Spec · interactive Claude Code');
  });

  test('stage: a branch not created yet is a read-only repo line', () => {
    const text = templateFor(ctx, stageSpec(ctx, 'T_csv'), STATE);
    expect(text).toContain(
      '- Repo: api (read only, in ~/code/acme/acme-platform-core-api-service)',
    );
  });

  test('start: task, Jira, repo line, open step', () => {
    const text = templateFor(ctx, startSpec('b_meter'), STATE);
    expect(text.split('\n')).toEqual([
      'Task: Usage-based billing',
      '- Jira: PAY-102 https://acme.atlassian.net/browse/PAY-102',
      '- Repo: api · Branch: feat/usage-metering · Worktree: ~/wt/api/usage-metering',
      'Step: Metering endpoints',
    ]);
  });
});

describe('send gating', () => {
  test('a blank message disables send, an edit marks the view edited', () => {
    const spec = rebaseSpec(ctx, 'b_bill', 'main', 't');
    expect(composeDialog(ctx, spec, { ...STATE, msg: '  \n' }).sendDisabled).toBe(true);
    const v = composeDialog(ctx, spec, { ...STATE, msg: 'go' });
    expect(v.edited).toBe(true);
    expect(v.sendDisabled).toBe(false);
  });
});

describe('turn watcher', () => {
  const ev = (event: string, terminalId = 't1') =>
    ({ terminalId, event }) as unknown as Parameters<
      ReturnType<typeof createTurnWatcher>['onEvent']
    >[0];

  test('a send ignores the Stop of the turn already running until its own prompt submits', async () => {
    const w = createTurnWatcher();
    const watch = w.watch('t1', { requireSubmit: true });
    let outcome = '';
    void watch.done.then((o) => {
      outcome = o;
    });
    w.onEvent(ev('Stop'));
    await Promise.resolve();
    expect(outcome).toBe('');
    w.onEvent(ev('UserPromptSubmit'));
    w.onEvent(ev('Stop'));
    expect(await watch.done).toBe('stop');
  });

  test("onSubmit fires once, on the watch's own prompt submit", () => {
    const w = createTurnWatcher();
    let submits = 0;
    w.watch('t1', { requireSubmit: true, onSubmit: () => submits++ });
    w.onEvent(ev('Stop'));
    expect(submits).toBe(0);
    w.onEvent(ev('UserPromptSubmit'));
    w.onEvent(ev('UserPromptSubmit'));
    expect(submits).toBe(1);
  });

  test('a launch counts its first Stop', async () => {
    const w = createTurnWatcher();
    const watch = w.watch('t1', { requireSubmit: false });
    w.onEvent(ev('Stop'));
    expect(await watch.done).toBe('stop');
  });

  test('SessionEnd ends the watch, other terminals are ignored', async () => {
    const w = createTurnWatcher();
    const watch = w.watch('t1', { requireSubmit: false });
    w.onEvent(ev('SessionEnd', 't2'));
    w.onEvent(ev('SessionEnd'));
    expect(await watch.done).toBe('ended');
  });

  test('a terminal never seen live is not ended, one seen live then gone is', async () => {
    const w = createTurnWatcher();
    const watch = w.watch('t1', { requireSubmit: false });
    w.onLive([]);
    let outcome = '';
    void watch.done.then((o) => {
      outcome = o;
    });
    await Promise.resolve();
    expect(outcome).toBe('');
    w.onLive(['t1']);
    w.onLive([]);
    expect(await watch.done).toBe('ended');
  });

  test('cancel detaches without resolving', async () => {
    const w = createTurnWatcher();
    const watch = w.watch('t1', { requireSubmit: false });
    watch.cancel();
    w.onEvent(ev('Stop'));
    const raced = await Promise.race([watch.done, Promise.resolve('pending')]);
    expect(raced).toBe('pending');
  });
});
